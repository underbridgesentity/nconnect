import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { publishedPlanBySlug, publishedBundleBySlug } from "@/lib/domain/catalogue";
import { MoneyText } from "@/components/shared/money-text";

export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false },
};

/**
 * Signup entry point. The three-step wizard ships with milestone M2; until
 * then this page is honest about it and routes people to a human — the
 * preselected plan/bundle context is preserved and shown.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; bundle?: string }>;
}) {
  const { plan: planSlug, bundle: bundleSlug } = await searchParams;
  const plan = planSlug ? await publishedPlanBySlug(planSlug) : null;
  const bundle = bundleSlug ? await publishedBundleBySlug(bundleSlug) : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Let&apos;s get you connected
      </h1>

      {plan ? (
        <div className="mt-6 rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">You&apos;ve chosen</p>
          <p className="font-semibold">{plan.name}</p>
          <p className="text-sm">
            <MoneyText cents={plan.priceCents} whole /> /month
            {plan.onceOffCents > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                + <MoneyText cents={plan.onceOffCents} whole /> once-off
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
      {bundle ? (
        <div className="mt-6 rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">You&apos;ve chosen</p>
          <p className="font-semibold">{bundle.name}</p>
          <p className="text-sm">
            <MoneyText cents={bundle.priceCents} whole />
          </p>
        </div>
      ) : null}

      <div className="mt-6 space-y-4 text-muted-foreground">
        <p>
          Online signup with card payment is in the final stretch of
          construction. Right now, the fastest way to get connected is a
          WhatsApp message — a real person picks it up, confirms coverage at
          your address, and sets everything up with you in one conversation.
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href={`https://wa.me/27866863078?text=${encodeURIComponent(
            `Hi! I'd like to sign up${plan ? ` for ${plan.name}` : bundle ? ` for the ${bundle.name} bundle` : ""}.`
          )}`}
          className="flex touch-target items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <MessageCircle className="size-4" aria-hidden />
          Sign up on WhatsApp
        </a>
        <Link
          href="/contact"
          className="flex touch-target items-center justify-center rounded-md border px-6 text-sm font-medium hover:bg-accent"
        >
          Other ways to reach us
        </Link>
      </div>
    </div>
  );
}
