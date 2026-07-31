import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db/client";
import { otpCodes } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { signIn } from "@/lib/auth";
import { normalizeEmail } from "./otp";

/**
 * Mint a session for an email address that was OTP-verified moments ago in the
 * same server flow (signup step 3). Issues a single-use internal code and
 * consumes it through the normal customer-email-otp provider, so session
 * creation still goes through exactly one code path.
 *
 * The code is never sent anywhere: it exists only long enough for the provider
 * on the next line to spend it, which is why sixty seconds is generous.
 */
export async function issueInternalSession(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.insert(otpCodes).values({
    identifier: email,
    channel: "email",
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + 60 * 1000), // 60s, single hop
  });
  await signIn("customer-email-otp", { email, code, redirect: false });
}
