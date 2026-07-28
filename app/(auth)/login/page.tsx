import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { callbackUrlFromParams } from "@/lib/auth/callback-url";
import {
  customerSignInNotice,
  signInReasonFromParams,
} from "@/lib/auth/sign-in-notice";
import { getSetting } from "@/lib/domain/settings";
import { SignInNoticeCard } from "../notice-card";
import { OtpLoginForm } from "./otp-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Needd Connect portal with a code sent to your cellphone.",
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // proxy.ts parks the page you were heading for on `next`; Auth.js uses
  // `callbackUrl`. Either way it is honoured, so a pay link opened while
  // signed out finishes where it started rather than on the portal home.
  const callbackUrl = callbackUrlFromParams(params);
  const reason = signInReasonFromParams(params);

  const session = await auth();
  if (session?.user?.role === "customer") {
    redirect(callbackUrl ?? "/portal");
  }

  // Anyone still here is signed out or holding a staff session that the role
  // gate refused at a /portal link. The second one deserves to be told the
  // account is wrong: they are signed in, so nothing on a cellphone form is
  // going to make sense of the bounce on its own.
  const notice = customerSignInNotice({
    reason,
    role: session?.user?.role ?? null,
    identity: session?.user?.email ?? session?.user?.name ?? null,
    destination: callbackUrl,
  });

  const company = await getSetting<{ phone?: string }>("company").catch(
    () => null
  );

  return (
    <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-7">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Sign in
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {callbackUrl
          ? "Verify your number and we will take you straight back to where you were."
          : "We send a 6-digit code to your cellphone. No password to remember."}
      </p>

      <SignInNoticeCard notice={notice} />

      <OtpLoginForm
        callbackUrl={callbackUrl ?? undefined}
        supportPhone={company?.phone ?? null}
      />

      <p className="mt-6 border-t pt-5 text-sm text-muted-foreground">
        No account yet?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Order a service
        </Link>{" "}
        and we will create one as you go.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Needd Connect staff sign in{" "}
        <Link href="/staff-login" className="hover:underline">
          here
        </Link>
        .
      </p>
    </div>
  );
}
