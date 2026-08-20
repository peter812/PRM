import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

// Parse S3_ENDPOINT to handle both formats: with or without protocol
const s3Endpoint = process.env.S3_ENDPOINT!;
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

const SAFE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"]);
const SAFE_MIMETYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]);

export async function uploadImageToS3(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<string> {
  const cleanMimeType = mimeType.toLowerCase();
  if (!SAFE_MIMETYPES.has(cleanMimeType)) {
    throw new Error("Invalid or unsafe image MIME type");
  }

  let fileExtension = originalFilename.split(".").pop()?.toLowerCase() || "jpg";
  if (!SAFE_EXTENSIONS.has(fileExtension)) {
    fileExtension = "jpg";
  }

  const fileName = `${nanoid()}.${fileExtension}`;
  const key = `images/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  try {
    await s3Client.send(command);
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

// ── Media (video/audio) storage ──

const SAFE_MEDIA_EXTENSIONS = new Set(["mp4", "m4a", "mp3", "webm", "mov", "ogg", "wav"]);
const SAFE_MEDIA_MIMETYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
]);

export async function uploadMediaToS3(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<string> {
  const cleanMimeType = mimeType.toLowerCase();
  if (!SAFE_MEDIA_MIMETYPES.has(cleanMimeType)) {
    throw new Error("Invalid or unsafe media MIME type");
  }

  let fileExtension = originalFilename.split(".").pop()?.toLowerCase() || "mp4";
  if (!SAFE_MEDIA_EXTENSIONS.has(fileExtension)) {
    fileExtension = "mp4";
  }

  const fileName = `${nanoid()}.${fileExtension}`;
  const key = `media/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  try {
    await s3Client.send(command);
  } catch (error) {
    console.error("S3 upload error details:", error);
    console.error("S3 Configuration - Endpoint:", endpoint);
    console.error("S3 Configuration - Bucket:", BUCKET_NAME);
    throw error;
  }

  const baseEndpoint = endpoint.replace(/^https?:\/\//, '');
  return `https://${baseEndpoint}/${BUCKET_NAME}/${key}`;
}

export async function deleteMediaFromS3(mediaUrl: string): Promise<void> {
  const urlParts = mediaUrl.split(`${BUCKET_NAME}/`);
  if (urlParts.length < 2) {
    throw new Error("Invalid media URL");
  }
  const key = urlParts[1];

  if (!key.startsWith("media/")) {
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
  const key = urlParts[1];

  // Verify we are only deleting objects from the images folder prefix
  if (!key.startsWith("images/")) {
    throw new Error("Access denied: Can only delete objects in images/ folder");
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}
