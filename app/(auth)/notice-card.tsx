import Link from "next/link";
import { ShieldAlert, Info } from "lucide-react";
import type { SignInNotice } from "@/lib/auth/sign-in-notice";

/**
 * The banner above a sign-in form that explains why the person is looking at
 * it: the role gate turned them away, their session ended, or they are already
 * signed in on an account that cannot open what they clicked.
 *
 * Both sign-in screens render the same shape, so it lives here rather than
 * being kept in step by hand. The copy itself is decided in
 * `lib/auth/sign-in-notice`, which is where the honesty rules are.
 */
export function SignInNoticeCard({ notice }: { notice: SignInNotice | null }) {
  if (!notice) return null;
  const blocked = notice.tone === "blocked";
  return (
    <div
      className={
        blocked
          ? "mt-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
          : "mt-5 rounded-2xl border border-primary/30 bg-primary/5 p-4"
      }
    >
      <p className="flex items-start gap-2 text-sm font-medium">
        {blocked ? (
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
        ) : (
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        )}
        <span className={blocked ? "text-destructive" : "text-foreground"}>
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
  );
}
