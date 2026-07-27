import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Info } from "lucide-react";
import { auth } from "@/lib/auth";
import { callbackUrlFromParams } from "@/lib/auth/callback-url";
import {
  signInReasonFromParams,
  staffSignInNotice,
} from "@/lib/auth/sign-in-notice";
import { StaffLoginForm } from "./staff-form";

export const metadata: Metadata = {
  title: "Staff sign in",
  robots: { index: false },
};

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Both values have been through the browser. The destination is reduced to
  // a same-origin relative path before it is shown or put in the form, and the
  // reason is matched against a closed list.
  const callbackUrl = callbackUrlFromParams(params);
  const reason = signInReasonFromParams(params);

  // The session is the honest account of who is here: the role gate sends a
  // signed-in person with the wrong role to this same form, and they deserve
  // to be told that rather than blaming their password.
  const session = await auth();
  const notice = staffSignInNotice({
    reason,
    role: session?.user?.role ?? null,
    identity: session?.user?.email ?? session?.user?.name ?? null,
    destination: callbackUrl,
  });

  return (
    <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-7">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Staff sign in
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        For Needd Connect team members.
      </p>

      {notice ? (
        <div
          className={
            notice.tone === "blocked"
              ? "mt-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
              : "mt-5 rounded-2xl border border-primary/30 bg-primary/5 p-4"
          }
        >
          <p className="flex items-start gap-2 text-sm font-medium">
            {notice.tone === "blocked" ? (
              <ShieldAlert
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden
              />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            )}
            <span
              className={
                notice.tone === "blocked" ? "text-destructive" : "text-foreground"
              }
            >
              {notice.title}
            </span>
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">{notice.detail}</p>
          {notice.destination ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              You were opening{" "}
              <span className="font-mono text-xs text-foreground">
                {notice.destination}
              </span>
              .
            </p>
          ) : null}
          {notice.onward ? (
            <Link
              href={notice.onward.href}
              className="mt-3 inline-flex touch-target items-center text-sm font-medium text-primary hover:underline"
            >
              {notice.onward.label}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6">
        <StaffLoginForm callbackUrl={callbackUrl ?? undefined} />
      </div>
      <p className="mt-6 border-t pt-5 text-sm text-muted-foreground">
        A customer?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in with your cellphone
        </Link>
        .
      </p>
    </div>
  );
}
