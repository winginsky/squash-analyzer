// AWS S3 storage helpers for Squash Analyzer
// Uploads files to S3 and returns CloudFront URLs for serving.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream } from "fs";

function getS3Client(): S3Client {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS credentials missing: set AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY",
    );
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
  return bucket;
}

function getPublicUrl(key: string): string {
  const cloudfrontUrl = process.env.AWS_CLOUDFRONT_URL;
  if (cloudfrontUrl) {
    return `${cloudfrontUrl.replace(/\/$/, "")}/${key}`;
  }
  // Fallback to direct S3 URL
  const bucket = getBucket();
  const region = process.env.AWS_REGION ?? "us-east-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Upload a Buffer/string to S3.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const s3 = getS3Client();
  const key = normalizeKey(relKey);
  const bucket = getBucket();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data as Buffer,
      ContentType: contentType,
    }),
  );

  return { key, url: getPublicUrl(key) };
}

/**
 * Stream-upload a local file to S3 using multipart upload.
 * Safe for large files (hundreds of MB) — never loads the whole file into RAM.
 */
export async function storagePutFile(
  relKey: string,
  filePath: string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const s3 = getS3Client();
  const key = normalizeKey(relKey);
  const bucket = getBucket();

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    },
  });

  await upload.done();
  return { key, url: getPublicUrl(key) };
}

/**
 * Get a public URL for an existing S3 object.
 */
export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: getPublicUrl(key) };
}

/**
 * Generate a presigned S3 PUT URL so the browser can upload directly to S3,
 * bypassing the API server (and any nginx body-size limits) entirely.
 */
export async function storagePresignPut(
  relKey: string,
  contentType: string,
  expiresIn = 3600,
): Promise<{ key: string; uploadUrl: string; publicUrl: string }> {
  const s3 = getS3Client();
  const key = normalizeKey(relKey);
  const bucket = getBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn });
  return { key, uploadUrl, publicUrl: getPublicUrl(key) };
}
