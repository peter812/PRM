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

export async function uploadImageToS3(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<string> {
  const fileExtension = originalFilename.split(".").pop() || "jpg";
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

export async function deleteImageFromS3(imageUrl: string): Promise<void> {
  const urlParts = imageUrl.split(`${BUCKET_NAME}/`);
  if (urlParts.length < 2) {
    throw new Error("Invalid image URL");
  }
  const key = urlParts[1];

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}
