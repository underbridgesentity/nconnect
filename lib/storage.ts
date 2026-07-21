import "server-only";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHmac } from "node:crypto";

/**
 * File storage (spec §3): Supabase Storage buckets `catalogue` (public read),
 * `compliance` and `documents` (private, short-lived signed URLs only).
 *
 * Dev fallback: without SUPABASE_URL the driver writes to `.uploads/` on disk
 * and serves via /api/files with HMAC-signed, expiring URLs, same contract,
 * recorded in PROGRESS.md. Production always uses Supabase.
 */

export type Bucket = "catalogue" | "compliance" | "documents";

const PUBLIC_BUCKETS: Bucket[] = ["catalogue"];
const LOCAL_ROOT = path.join(process.cwd(), ".uploads");

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function localSignature(bucket: string, filePath: string, expires: number) {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return createHmac("sha256", secret)
    .update(`${bucket}:${filePath}:${expires}`)
    .digest("hex");
}

export function verifyLocalSignature(
  bucket: string,
  filePath: string,
  expires: number,
  signature: string
): boolean {
  if (Date.now() / 1000 > expires) return false;
  return localSignature(bucket, filePath, expires) === signature;
}

export async function uploadFile(
  bucket: Bucket,
  filePath: string,
  data: Buffer,
  contentType: string
): Promise<{ path: string }> {
  if (supabaseConfigured()) {
    const { error } = await supabaseAdmin()
      .storage.from(bucket)
      .upload(filePath, data, { contentType, upsert: true });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    return { path: filePath };
  }
  const target = path.join(LOCAL_ROOT, bucket, filePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
  return { path: filePath };
}

export async function readLocalFile(
  bucket: string,
  filePath: string
): Promise<Buffer> {
  const target = path.join(LOCAL_ROOT, bucket, filePath);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(LOCAL_ROOT))) {
    throw new Error("path traversal");
  }
  return readFile(resolved);
}

/**
 * URL for rendering a stored file. Public bucket files get stable URLs;
 * private buckets get short-lived signed URLs (default 10 minutes).
 * Signed-URL issuance for compliance docs is audited at the call site.
 */
export async function fileUrl(
  bucket: Bucket,
  filePath: string,
  opts: { expiresInSeconds?: number } = {}
): Promise<string> {
  const expiresIn = opts.expiresInSeconds ?? 600;
  if (supabaseConfigured()) {
    const storage = supabaseAdmin().storage.from(bucket);
    if (PUBLIC_BUCKETS.includes(bucket)) {
      return storage.getPublicUrl(filePath).data.publicUrl;
    }
    const { data, error } = await storage.createSignedUrl(filePath, expiresIn);
    if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
    return data.signedUrl;
  }
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const sig = localSignature(bucket, filePath, expires);
  return `/api/files/${bucket}/${filePath}?e=${expires}&s=${sig}`;
}

export function randomFileName(ext: string): string {
  return `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
}
