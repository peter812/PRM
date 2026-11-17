import assert from "node:assert/strict";
import { allBuckets, bucketForKey, defaultBucket, parseBucketSettings } from "../server/prm-s3-buckets";
import { normalizePublicUrlsToProxyPaths } from "../server/middleware/prm-s3-direct";
import { normalizePrmS3Key, presignPrmS3PublicUrl, type PrmS3Config } from "../server/prm-s3";

// The same cases as PRM-compute's tests/test_bucket_map.py.
console.log("Running bucket map tests...");

const single: PrmS3Config = {
  endpoint: "http://s3:9000",
  publicEndpoint: "https://cdn.example.com",
  baseBucket: "images",
  bucketMap: {},
  bucketPrefix: "",
  region: "us-east-1",
  accessKeyId: "key",
  secretAccessKey: "secret",
  deliveryMode: "direct",
  directDelivery: true,
  isConfigured: true,
};
const split: PrmS3Config = { ...single, bucketMap: { "media/": "media" }, bucketPrefix: "prod-" };

// One bucket when neither is set.
assert.equal(bucketForKey(single, "media/a.mp4"), "images");
assert.equal(defaultBucket(single), "images");
assert.deepEqual(allBuckets(single), ["images"]);

// The lookup matches the first segment exactly.
assert.equal(bucketForKey(split, "media/a.mp4"), "prod-media");
assert.equal(bucketForKey(split, "media/"), "prod-media");
assert.equal(bucketForKey(split, "faces/a.jpg"), "prod-images");
assert.equal(bucketForKey(split, "mediafiles/a.mp4"), "prod-images");
assert.equal(bucketForKey(split, "media"), "prod-images");
assert.equal(bucketForKey(split, "images/media/a.jpg"), "prod-images");

// Names.
assert.equal(defaultBucket(split), "prod-images");
assert.deepEqual(allBuckets(split), ["prod-images", "prod-media"]);
assert.deepEqual(allBuckets({ baseBucket: "images", bucketMap: { "media/": "images" }, bucketPrefix: "dev-" }), ["dev-images"]);

// Every folder in its own bucket: six lines, since images/ uses the default.
const everyFolder: PrmS3Config = {
  ...split,
  bucketMap: Object.fromEntries(["profiles", "posts", "stories", "media", "faces", "references"].map((name) => [`${name}/`, name])),
};
for (const name of ["profiles", "posts", "stories", "media", "faces", "references"]) {
  assert.equal(bucketForKey(everyFolder, `${name}/a.jpg`), `prod-${name}`);
}
assert.equal(bucketForKey(everyFolder, "images/a.jpg"), "prod-images");
assert.equal(allBuckets(everyFolder).length, 7);
assert.equal(allBuckets(everyFolder)[0], "prod-images");
assert.deepEqual(parseBucketSettings("images", JSON.stringify(everyFolder.bucketMap), "prod-").bucketMap, everyFolder.bucketMap);

// Reading the rows.
assert.deepEqual(parseBucketSettings("images", null, null), { bucketMap: {}, bucketPrefix: "" });
assert.deepEqual(parseBucketSettings("images", " ", " "), { bucketMap: {}, bucketPrefix: "" });
assert.deepEqual(parseBucketSettings("images", '{"media/":"media"}', " prod- "), { bucketMap: { "media/": "media" }, bucketPrefix: "prod-" });
assert.deepEqual(parseBucketSettings("Old_Name", "", ""), { bucketMap: {}, bucketPrefix: "" }, "today's settings stay readable");

for (const [mapText, prefix] of [
  ["not json", ""],
  ['["media/"]', ""],
  ["null", ""],
  ['{"media": "media"}', ""], // no slash
  ['{"other/": "media"}', ""], // not one of the folders
  ['{"media/": ""}', ""],
  ['{"media/": 3}', ""],
  ['{"media/": "Bad_Name"}', ""],
  ["", "Prod-"],
  ["", "-prod"],
  ["", "pr od"],
  ["", "p".repeat(60)], // too long with "images"
]) {
  assert.throws(() => parseBucketSettings("images", mapText, prefix), undefined, `${mapText} ${prefix}`);
}

// Signed URLs name the bucket their key lives in.
const path = (url: string) => new URL(url).pathname;
assert.equal(path(presignPrmS3PublicUrl(split, "media/a.mp4")), "/prod-media/media/a.mp4");
assert.equal(path(presignPrmS3PublicUrl(split, "faces/a.jpg")), "/prod-images/faces/a.jpg");
assert.equal(path(presignPrmS3PublicUrl(single, "media/a.mp4")), "/images/media/a.mp4");
assert.equal(path(presignPrmS3PublicUrl(split, "", { bucket: "prod-media" })), "/prod-media");
// The same key under two configs doesn't share a memoised URL.
const elsewhere: PrmS3Config = { ...split, bucketPrefix: "dev-" };
assert.equal(path(presignPrmS3PublicUrl(elsewhere, "media/a.mp4")), "/dev-media/media/a.mp4");

// A signed URL coming back is stored as its proxy path.
const inbound = (url: string, cfg = split) => (normalizePublicUrlsToProxyPaths({ url }, cfg) as { url: string }).url;
assert.equal(inbound("https://cdn.example.com/prod-media/media/a.mp4?X-Amz-Signature=x"), "/api/prm-s3/media/a.mp4");
assert.equal(inbound("https://cdn.example.com/prod-images/faces/a.jpg?X-Amz-Signature=x"), "/api/prm-s3/faces/a.jpg");
assert.equal(inbound("https://cdn.example.com/images/faces/a.jpg?X-Amz-Signature=x"), "/api/prm-s3/faces/a.jpg", "signed before the prefix was set");
assert.equal(inbound("https://cdn.example.com/media/media/a.mp4?X-Amz-Signature=x"), "/api/prm-s3/media/a.mp4", "signed before the prefix was set");
assert.equal(inbound("https://cdn.example.com/other/media/a.mp4"), "https://cdn.example.com/other/media/a.mp4", "another bucket");
assert.equal(inbound("https://elsewhere.example.com/prod-media/media/a.mp4"), "https://elsewhere.example.com/prod-media/media/a.mp4", "another host");
assert.equal(inbound("https://cdn.example.com/prod-faces/faces/a.jpg?X-Amz-Signature=x", everyFolder), "/api/prm-s3/faces/a.jpg");
assert.equal(inbound("https://cdn.example.com/images/faces/a.jpg?X-Amz-Signature=x", everyFolder), "/api/prm-s3/faces/a.jpg", "signed before the split");
const dotted: PrmS3Config = { ...single, baseBucket: "a.b" };
assert.equal(inbound("https://cdn.example.com/a.b/faces/a.jpg", dotted), "/api/prm-s3/faces/a.jpg");
assert.equal(inbound("https://cdn.example.com/axb/faces/a.jpg", dotted), "https://cdn.example.com/axb/faces/a.jpg", "name is escaped");

// Keys read back out of a mapped bucket's URL.
assert.equal(normalizePrmS3Key("https://cdn.example.com/prod-media/media/a.mp4?x=1"), "media/a.mp4");

console.log("All bucket map tests passed.");
