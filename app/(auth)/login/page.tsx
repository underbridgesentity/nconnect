import type { Metadata } from "next";
import { OtpLoginForm } from "./otp-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <div className="rounded-lg border bg-card p-6">
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We&apos;ll send a 6-digit code to your cellphone.
      </p>
      <div className="mt-6">
        <OtpLoginForm />
      </div>
    </div>
  );
}
