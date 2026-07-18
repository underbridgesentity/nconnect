import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { otpCodes } from "@/lib/db/schema";
import { sha256, safeEqualHex } from "@/lib/crypto";
import { getSmsAdapter } from "@/lib/notify/sms";
import { sendWhatsAppTemplate, whatsappEnabled } from "@/lib/notify/whatsapp";

/**
 * OTP service (spec §3.2, §10.1): 6 digits, hashed at rest, 5-minute expiry,
 * rate-limited per phone and per IP. Delivery: WhatsApp first, SMS fallback,
 * console driver in dev.
 */

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_PER_PHONE_PER_HOUR = 5;
const MAX_PER_IP_PER_HOUR = 15;
const MAX_VERIFY_ATTEMPTS = 5;

export class OtpRateLimitError extends Error {
  constructor() {
    super("Too many OTP requests. Please wait a while and try again.");
    this.name = "OtpRateLimitError";
  }
}

export function normalizePhone(input: string): string {
  // South African numbers to E.164. Accepts 0821234567, 27821234567, +27821234567.
  const digits = input.replace(/[\s()-]/g, "");
  if (/^\+27\d{9}$/.test(digits)) return digits;
  if (/^27\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`;
  throw new Error("Enter a valid South African cellphone number");
}

export async function requestOtp(
  rawPhone: string,
  ip: string | null
): Promise<{ sent: true; channel: string }> {
  const phone = normalizePhone(rawPhone);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [phoneCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, oneHourAgo)));
  if (phoneCount.n >= MAX_PER_PHONE_PER_HOUR) throw new OtpRateLimitError();

  if (ip) {
    const [ipCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(and(eq(otpCodes.ip, ip), gt(otpCodes.createdAt, oneHourAgo)));
    if (ipCount.n >= MAX_PER_IP_PER_HOUR) throw new OtpRateLimitError();
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.insert(otpCodes).values({
    phone,
    ip,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  // WhatsApp first, SMS fallback (console driver in dev).
  if (whatsappEnabled()) {
    const wa = await sendWhatsAppTemplate({
      to: phone,
      template: "otp_login",
      bodyParams: [code],
    });
    if (wa.ok) return { sent: true, channel: "whatsapp" };
  }
  const sms = getSmsAdapter();
  const result = await sms.send(
    phone,
    `${code} is your Needd Connect verification code. It expires in 5 minutes.`
  );
  if (!result.ok) {
    throw new Error(`Could not send the code: ${result.detail}`);
  }
  return { sent: true, channel: `sms:${sms.name}` };
}

export async function verifyOtp(
  rawPhone: string,
  code: string
): Promise<{ ok: boolean; phone: string }> {
  const phone = normalizePhone(rawPhone);
  const now = new Date();

  const candidates = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.phone, phone),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, now)
      )
    )
    .orderBy(sql`${otpCodes.createdAt} desc`)
    .limit(1);

  const record = candidates[0];
  if (!record) return { ok: false, phone };
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) return { ok: false, phone };

  await db
    .update(otpCodes)
    .set({ attempts: record.attempts + 1 })
    .where(eq(otpCodes.id, record.id));

  const match = safeEqualHex(
    Buffer.from(sha256(code), "utf8").toString("hex"),
    Buffer.from(record.codeHash, "utf8").toString("hex")
  );
  if (!match) return { ok: false, phone };

  await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(eq(otpCodes.id, record.id));
  return { ok: true, phone };
}
