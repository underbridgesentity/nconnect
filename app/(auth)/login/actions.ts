"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requestOtp, OtpRateLimitError } from "@/lib/auth/otp";
import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

const phoneSchema = z.object({ phone: z.string().min(9).max(15) });
const verifySchema = z.object({
  phone: z.string().min(9).max(15),
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits"),
});

export type OtpFormState = {
  step: "phone" | "code";
  phone?: string;
  error?: string;
};

export async function requestOtpAction(
  _prev: OtpFormState,
  formData: FormData
): Promise<OtpFormState> {
  const parsed = phoneSchema.safeParse({ phone: formData.get("phone") });
  if (!parsed.success) {
    return { step: "phone", error: "Enter a valid cellphone number" };
  }
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
  try {
    await requestOtp(parsed.data.phone, ip);
    return { step: "code", phone: parsed.data.phone };
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      return { step: "phone", error: err.message };
    }
    return {
      step: "phone",
      error: err instanceof Error ? err.message : "Could not send the code",
    };
  }
}

export async function verifyOtpAction(
  _prev: OtpFormState,
  formData: FormData
): Promise<OtpFormState> {
  const parsed = verifySchema.safeParse({
    phone: formData.get("phone"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return {
      step: "code",
      phone: String(formData.get("phone") ?? ""),
      error: "Enter the 6-digit code",
    };
  }
  try {
    await signIn("customer-otp", {
      phone: parsed.data.phone,
      code: parsed.data.code,
      redirectTo: "/portal",
    });
    return { step: "code", phone: parsed.data.phone };
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        step: "code",
        phone: parsed.data.phone,
        error:
          "That code didn't match. Check it and try again, or request a new one.",
      };
    }
    throw err; // NEXT_REDIRECT on success
  }
}
