import assert from "node:assert/strict";
import { withImageSize, isValidImageSize } from "../shared/image-size";
import { normalizePublicUrlsToProxyPaths } from "../server/middleware/prm-s3-direct";
import type { PrmS3Config } from "../server/prm-s3";

console.log("Running image size tests...");

// Test 1: isValidImageSize
assert.equal(isValidImageSize(64), true);
assert.equal(isValidImageSize(150), true);
assert.equal(isValidImageSize(1080), true);
assert.equal(isValidImageSize("max"), true);
assert.equal(isValidImageSize("64"), true);
assert.equal(isValidImageSize("150"), true);
assert.equal(isValidImageSize("1080"), true);
assert.equal(isValidImageSize(200), false);
assert.equal(isValidImageSize("300"), false);
assert.equal(isValidImageSize(""), false);
assert.equal(isValidImageSize(null), false);
assert.equal(isValidImageSize(undefined), false);

// Test 2: withImageSize
assert.equal(withImageSize(undefined, 64), undefined);
assert.equal(withImageSize(null, 64), undefined);
assert.equal(withImageSize("", 64), "");

// Appending to bare path
assert.equal(withImageSize("/api/prm-s3/images/abc.jpg", 64), "/api/prm-s3/images/abc.jpg?s=64");
assert.equal(withImageSize("/api/prm-s3/images/abc.jpg", 150), "/api/prm-s3/images/abc.jpg?s=150");
assert.equal(withImageSize("/api/prm-s3/images/abc.jpg", 1080), "/api/prm-s3/images/abc.jpg?s=1080");
assert.equal(withImageSize("/api/prm-s3/images/abc.jpg", "max"), "/api/prm-s3/images/abc.jpg?s=max");

// Appending to presigned URL with existing query
assert.equal(
  withImageSize("https://cdn.example.com/images/abc.jpg?X-Amz-Algorithm=AWS4&X-Amz-Signature=abc", 64),
  "https://cdn.example.com/images/abc.jpg?X-Amz-Algorithm=AWS4&X-Amz-Signature=abc&s=64"
);

// Replacing existing s
assert.equal(withImageSize("/api/prm-s3/images/abc.jpg?s=64", 150), "/api/prm-s3/images/abc.jpg?s=150");
assert.equal(
  withImageSize("https://cdn.example.com/images/abc.jpg?X-Amz-Signature=abc&s=64", 1080),
  "https://cdn.example.com/images/abc.jpg?X-Amz-Signature=abc&s=1080"
);

// Non-PRM-S3 URLs are left alone
const igUrl = "https://scontent-lax3-1.cdninstagram.com/v/t51.2885-19/abc.jpg?stp=dst-jpg_s150x150&_nc_ht=x&oh=y&oe=z";
assert.equal(withImageSize(igUrl, 64), igUrl);
assert.equal(withImageSize("https://example.org/photo.png", 150), "https://example.org/photo.png");
assert.equal(withImageSize("https://example.org/photo.png?v=2", "max"), "https://example.org/photo.png?v=2");

// Test 3: normalizePublicUrlsToProxyPaths
const mockConfig: PrmS3Config = {
  endpoint: "http://localhost:9000",
  publicEndpoint: "https://prm-cdn.example.com",
  bucket: "images",
  region: "us-east-1",
  accessKeyId: "key",
  secretAccessKey: "secret",
  deliveryMode: "direct",
  directDelivery: true,
  isConfigured: true,
};

// Sized direct URL -> bare proxy path
const directSized = {
  imageUrl: "https://prm-cdn.example.com/images/images/test.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&s=64",
};
const normalized1 = normalizePublicUrlsToProxyPaths(directSized, mockConfig) as typeof directSized;
assert.equal(normalized1.imageUrl, "/api/prm-s3/images/test.jpg");

// Bare direct URL -> bare proxy path
const directBare = {
  imageUrl: "https://prm-cdn.example.com/images/images/test.jpg",
};
const normalized2 = normalizePublicUrlsToProxyPaths(directBare, mockConfig) as typeof directBare;
assert.equal(normalized2.imageUrl, "/api/prm-s3/images/test.jpg");

// Sized proxy path -> bare proxy path
const proxySized = {
  imageUrl: "/api/prm-s3/images/test.jpg?s=150",
};
const normalized3 = normalizePublicUrlsToProxyPaths(proxySized, mockConfig) as typeof proxySized;
assert.equal(normalized3.imageUrl, "/api/prm-s3/images/test.jpg");

// Faces path
const faceSized = {
  imageUrl: "/api/prm-s3/faces/crop_123.jpg?s=64",
};
const normalized4 = normalizePublicUrlsToProxyPaths(faceSized, mockConfig) as typeof faceSized;
assert.equal(normalized4.imageUrl, "/api/prm-s3/faces/crop_123.jpg");

// Phase 3 Tests: putPrmS3Object and schema
import { putPrmS3Object, normalizePrmS3Key } from "../server/prm-s3";
import { socialAccounts, socialAccountHistory } from "@shared/schema";

assert.equal(typeof putPrmS3Object, "function");
assert.equal(normalizePrmS3Key("/api/prm-s3/images/profile.jpg?s=150"), "images/profile.jpg");
assert.equal(normalizePrmS3Key("https://prm-cdn.example.com/images/profile.jpg?s=64"), "images/profile.jpg");

// Check socialAccounts schema has isHqImage
assert.ok(socialAccounts.isHqImage, "socialAccounts.isHqImage column exists in schema");
assert.ok(socialAccountHistory.previousImageUrl, "socialAccountHistory.previousImageUrl exists");
// The _hq columns are retired: only migrate_profile_image_tiers / db-init touch them, raw.
assert.equal((socialAccounts as any).imageUrlHq, undefined, "socialAccounts.imageUrlHq is gone from the schema");
assert.equal((socialAccountHistory as any).previousImageUrlHq, undefined, "socialAccountHistory.previousImageUrlHq is gone from the schema");

console.log("All Phase 2 and Phase 3 unit tests passed successfully!");
