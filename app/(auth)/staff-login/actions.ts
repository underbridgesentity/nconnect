"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { safeCallbackUrl } from "@/lib/auth/callback-url";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type StaffLoginState = { error?: string };

export async function staffLoginAction(
  _prev: StaffLoginState,
  formData: FormData
): Promise<StaffLoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter your email and password" };
  }
  // Deep link first, role router second: proxy.ts records the page that
  // bounced you here, and /after-login sorts by role when it did not.
  const destination = safeCallbackUrl(formData.get("callbackUrl"));
  try {
    await signIn("staff", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: destination ?? "/after-login",
    });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Email or password incorrect, or account disabled." };
    }
    throw err; // NEXT_REDIRECT on success
  }
}
