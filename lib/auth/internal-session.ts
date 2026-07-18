import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db/client";
import { otpCodes } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { signIn } from "@/lib/auth";
import { normalizePhone } from "./otp";

/**
 * Mint a session for a phone number that was OTP-verified moments ago in the
 * same server flow (signup step 3). Issues a single-use internal code and
 * consumes it through the normal customer-otp provider, so session creation
 * still goes through exactly one code path.
 */
export async function issueInternalSession(rawPhone: string): Promise<void> {
  const phone = normalizePhone(rawPhone);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.insert(otpCodes).values({
    phone,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + 60 * 1000), // 60s, single hop
  });
  await signIn("customer-otp", { phone, code, redirect: false });
}
