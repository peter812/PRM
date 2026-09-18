import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { newUploadName, type UploadKind } from "./upload-names";

// Parse S3_ENDPOINT to handle both formats: with or without protocol
const s3Endpoint = process.env.S3_ENDPOINT || "";
const endpoint = s3Endpoint.startsWith('http://') || s3Endpoint.startsWith('https://') 
  ? s3Endpoint 
  : `https://${s3Endpoint}`;

const s3Client = new S3Client({
  endpoint,
  region: "auto",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET!;

/** The only key prefixes this app writes; deletes and sweeps never reach outside them. */
export const STORAGE_KEY_PREFIXES = ["images/", "media/", "faces/"];

/**
 * A transfer source that no longer exists. The reference is dead rather than
 * retryable, so the transfer clears it instead of counting a failure.
 */
export class ObjectMissingError extends Error {}

/** True for a url this module produced (an object in our bucket on our endpoint). */
export function isS3ImageUrl(url: string): boolean {
  return url.startsWith(`https://${endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${BUCKET_NAME}/`);
}

/**
 * Reads an object in our bucket with our credentials. Objects are not public,
 * so an anonymous fetch of the url 403s for anything uploaded without a public
 * ACL — which is what stranded 1271 images on the S3 → PRM-S3 transfer.
 */
export async function getS3ObjectBuffer(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const key = imageUrl.split(`${BUCKET_NAME}/`)[1]?.split("?")[0];
  if (!key) throw new Error("Invalid S3 URL");
  const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key })).catch((err) => {
    // The SDK's message for this is "UnknownError"; the transfer report needs a real one.
    throw err?.name === "NoSuchKey" ? new ObjectMissingError(`S3 object no longer exists: ${key}`) : err;
  });
  if (!res.Body) throw new Error(`Empty body for object: ${key}`);
  return {
    buffer: Buffer.from(await res.Body.transformToByteArray()),
    mimeType: res.ContentType || "image/jpeg",
  };
}

async function putObject(kind: UploadKind, buffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
  const { key } = newUploadName(kind, originalFilename, mimeType);
  try {
    await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: buffer, ContentType: mimeType }));
  } catch (error) {
    console.error("S3 upload error details:", error);
    console.error("S3 Configuration - Endpoint:", endpoint);
    console.error("S3 Configuration - Bucket:", BUCKET_NAME);
    throw error;
  }
  // Extract the base URL without protocol for constructing the public URL
  const baseEndpoint = endpoint.replace(/^https?:\/\//, '');
  return `https://${baseEndpoint}/${BUCKET_NAME}/${key}`;
}

export function uploadImageToS3(buffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
  return putObject("image", buffer, originalFilename, mimeType);
}

export function uploadMediaToS3(buffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
  return putObject("media", buffer, originalFilename, mimeType);
}

/** Every object key in our bucket under STORAGE_KEY_PREFIXES. */
export async function listS3ObjectKeys(): Promise<string[]> {
  const keys: string[] = [];
  for (const Prefix of STORAGE_KEY_PREFIXES) {
    let ContinuationToken: string | undefined;
    do {
      const res = await s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix, ContinuationToken }));
      for (const obj of res.Contents || []) if (obj.Key) keys.push(obj.Key);
      ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }
  return keys;
}

export function s3KeyFromUrl(url: string): string | null {
  return url.split(`${BUCKET_NAME}/`)[1]?.split("?")[0] || null;
}

export async function deleteS3ObjectKey(key: string): Promise<void> {
  if (key.includes("..") || !STORAGE_KEY_PREFIXES.some(p => key.startsWith(p))) {
    throw new Error(`Access denied: Can only delete objects under ${STORAGE_KEY_PREFIXES.join(", ")}`);
  }
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
}

export async function deleteMediaFromS3(mediaUrl: string): Promise<void> {
  const urlParts = mediaUrl.split(`${BUCKET_NAME}/`);
  if (urlParts.length < 2) {
    throw new Error("Invalid media URL");
  }
  const key = urlParts[1].split(/[?#]/)[0];

  if (key.includes("..") || !key.startsWith("media/")) {
    throw new Error("Access denied: Can only delete objects in media/ folder");
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}

export async function deleteImageFromS3(imageUrl: string): Promise<void> {
  const urlParts = imageUrl.split(`${BUCKET_NAME}/`);
  if (urlParts.length < 2) {
    throw new Error("Invalid image URL");
  }
  const key = urlParts[1].split(/[?#]/)[0];

  // Verify we are only deleting objects from the images/faces folder prefixes
  if (key.includes("..") || (!key.startsWith("images/") && !key.startsWith("faces/"))) {
    throw new Error("Access denied: Can only delete objects in images/ or faces/ folder");
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}
