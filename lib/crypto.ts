import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * App-layer AES-256-GCM for ID numbers (spec §13). Ciphertext format:
 * base64(iv[12] || tag[16] || ciphertext). Decrypt only in the RICA
 * verification view; everywhere else use maskIdNumber().
 */

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes base64-encoded");
  }
  return buf;
}

export function encryptSensitive(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSensitive(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** "9202204720082" -> "*** *** 0082" */
export function maskIdNumber(idNumber: string): string {
  const tail = idNumber.slice(-4);
  return `*** *** ${tail}`;
}

/** Constant-time SHA-256 comparison for OTPs and one-time tokens. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
