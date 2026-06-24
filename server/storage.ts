/**
 * Storage helpers using AWS S3 directly.
 * Credentials come from environment variables:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 *   AWS_S3_BUCKET, AWS_CLOUDFRONT_URL
 */

import { createReadStream } from "fs";
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });
}

function getBucket(): string {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET environment variable is not set");
  return bucket;
}

function getPublicUrl(key: string): string {
  const cfUrl = process.env.AWS_CLOUDFRONT_URL;
  if (cfUrl) {
    return `${cfUrl.replace(/\/$/, "")}/${key}`;
  }
  const region = process.env.AWS_REGION ?? "us-east-1";
  const bucket = getBucket();
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Upload a Buffer to S3 and return the public URL.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: data instanceof Buffer ? data : Buffer.from(data as any),
    ContentType: contentType,
  }));
  return { key, url: getPublicUrl(key) };
}

/**
 * Upload a local file to S3 via streaming (safe for large files).
 */
export async function storagePutFile(
  relKey: string,
  filePath: string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: createReadStream(filePath) as any,
    ContentType: contentType,
  }));
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
 * bypassing the nginx proxy (which has timeout/size limits).
 * Expires in 1 hour.
 */
export async function getPresignedUploadUrl(
  relKey: string,
  contentType = "video/mp4",
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const key = normalizeKey(relKey);
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
  return { uploadUrl, publicUrl: getPublicUrl(key), key };
}

/**
 * Create a multipart upload and return presigned URLs for each part.
 * The browser uploads each part in parallel, then calls completeMultipartUpload.
 * Each part must be at least 5 MB (except the last). partCount should be 5–20.
 */
export async function createMultipartUpload(
  relKey: string,
  contentType = "video/mp4",
  partCount = 10,
): Promise<{ uploadId: string; key: string; publicUrl: string; partUrls: string[] }> {
  const key = normalizeKey(relKey);
  const client = getS3Client();
  const bucket = getBucket();

  const { UploadId } = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket, Key: key, ContentType: contentType,
  }));
  if (!UploadId) throw new Error("S3 did not return an UploadId");

  const partUrls = await Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      getSignedUrl(client, new UploadPartCommand({
        Bucket: bucket, Key: key, UploadId, PartNumber: i + 1,
      }), { expiresIn: 3600 }),
    ),
  );

  return { uploadId: UploadId, key, publicUrl: getPublicUrl(key), partUrls };
}

/**
 * Complete a multipart upload after all parts have been uploaded by the browser.
 */
export async function completeMultipartUpload(
  relKey: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  const key = normalizeKey(relKey);
  const client = getS3Client();
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: getBucket(),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  }));
}

/**
 * Abort a multipart upload (cleanup on error).
 */
export async function abortMultipartUpload(relKey: string, uploadId: string): Promise<void> {
  const key = normalizeKey(relKey);
  const client = getS3Client();
  await client.send(new AbortMultipartUploadCommand({
    Bucket: getBucket(), Key: key, UploadId: uploadId,
  })).catch(() => {});
}
