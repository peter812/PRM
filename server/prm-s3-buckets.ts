/**
 * Which bucket a storage key lives in. Imports nothing from the database, so
 * scripts and tests can use it alone. PRM-compute's s3.py mirrors this file.
 *
 * Settings hold logical names (`prm_s3_bucket`, the values of
 * `prm_s3_bucket_map`). The full name on PRM-S3 is prefix + logical name, and
 * only the functions here add the prefix.
 */

/** The only key prefixes this app writes; deletes and sweeps never reach outside them. */
export const STORAGE_KEY_PREFIXES = ["images/", "profiles/", "posts/", "stories/", "media/", "faces/", "references/"];

export type BucketConfig = {
  baseBucket: string;
  bucketMap: Record<string, string>;
  bucketPrefix: string;
};

const BUCKET_PREFIX_RE = /^[a-z0-9][a-z0-9.-]*$/;
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export function bucketForKey(cfg: BucketConfig, key: string): string {
  const folder = key.slice(0, key.indexOf("/") + 1);
  return cfg.bucketPrefix + (cfg.bucketMap[folder] ?? cfg.baseBucket);
}

export function defaultBucket(cfg: BucketConfig): string {
  return cfg.bucketPrefix + cfg.baseBucket;
}

/** Every bucket this config uses, the default first. */
export function allBuckets(cfg: BucketConfig): string[] {
  return Array.from(new Set([cfg.baseBucket, ...Object.values(cfg.bucketMap)].map((name) => cfg.bucketPrefix + name)));
}

/**
 * Reads the two optional rows. Throws on a malformed row: falling back to the
 * default bucket or to no prefix would put objects in the wrong place, which
 * on a shared server may be another instance's bucket. Names are only checked
 * once either row is set, so existing single-bucket settings keep working.
 */
export function parseBucketSettings(
  baseBucket: string,
  mapText: string | null | undefined,
  prefixText: string | null | undefined,
): { bucketMap: Record<string, string>; bucketPrefix: string } {
  const bucketPrefix = (prefixText ?? "").trim();
  if (bucketPrefix && !BUCKET_PREFIX_RE.test(bucketPrefix)) {
    throw new Error(`PRM-S3 bucket prefix '${bucketPrefix}' is malformed.`);
  }

  let bucketMap: Record<string, string> = {};
  if ((mapText ?? "").trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mapText!);
    } catch {
      throw new Error("PRM-S3 bucket map is not valid JSON.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("PRM-S3 bucket map is not a JSON object.");
    }
    for (const [folder, name] of Object.entries(parsed)) {
      if (!STORAGE_KEY_PREFIXES.includes(folder)) throw new Error(`PRM-S3 bucket map has an unknown folder '${folder}'.`);
      if (typeof name !== "string" || !name) throw new Error(`PRM-S3 bucket map has no bucket for ${folder}.`);
    }
    bucketMap = parsed as Record<string, string>;
  }

  if (bucketPrefix || Object.keys(bucketMap).length > 0) {
    for (const name of [baseBucket, ...Object.values(bucketMap)]) {
      if (!BUCKET_NAME_RE.test(bucketPrefix + name)) throw new Error(`PRM-S3 bucket name '${bucketPrefix + name}' is not valid.`);
    }
  }
  return { bucketMap, bucketPrefix };
}
