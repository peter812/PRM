import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

const s3Client = new S3Client({
  endpoint: `https://${process.env.S3_ENDPOINT}`,
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

  await s3Client.send(command);

  return `https://${process.env.S3_ENDPOINT}/${BUCKET_NAME}/${key}`;
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
