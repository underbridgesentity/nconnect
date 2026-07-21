"use server";

import { AuthError } from "next-auth";
import { completeSetup } from "@/lib/domain/staff";
import { signIn } from "@/lib/auth";

export type SetupState = { error?: string };

export async function setupAction(
  _prev: SetupState,
  form: FormData
): Promise<SetupState> {
  let email: string;
  const password = String(form.get("password"));
  try {
    const result = await completeSetup({
      token: String(form.get("token")),
      name: String(form.get("name")),
      password,
    });
    email = result.email;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Setup failed" };
  }
  try {
    await signIn("staff", { email, password, redirectTo: "/after-login" });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Account activated, sign in at /staff-login." };
    }
    throw err; // NEXT_REDIRECT
  }
}
