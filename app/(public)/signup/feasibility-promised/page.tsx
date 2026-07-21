import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "We're checking your address",
  robots: { index: false },
};

export default function FeasibilityPromisedPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <MessageCircle className="mx-auto size-10 text-primary" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold">We&apos;re on it.</h1>
      <p className="mt-2 text-muted-foreground">
        We confirm fibre availability at your address within one business day,
        on WhatsApp. Your plan choice is saved, once we confirm, signup takes
        two minutes.
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        In the meantime, uncapped LTE works almost everywhere and activates in
        days:
      </p>
      <Link
        href="/internet"
        className="mx-auto mt-3 flex w-fit touch-target items-center rounded-md border px-6 text-sm font-medium hover:bg-accent"
      >
        See LTE plans
      </Link>
    </div>
  );
}
