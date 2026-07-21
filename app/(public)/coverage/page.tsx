import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/public/page-header";
import { coverageCheckAction } from "./actions";

export const metadata: Metadata = {
  title: "Check Coverage",
  description:
    "Check LTE, 5G and fibre availability at your address. Fibre feasibility confirmed within one business day on WhatsApp.",
  alternates: { canonical: "/coverage" },
};

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; kind?: string }>;
}) {
  const { result, kind = "lte" } = await searchParams;

  return (
    <>
      <PageHeader
        image="/marketing/support.webp"
        imageAlt="A support agent ready to help with a coverage check"
        title="Check coverage at your address"
      >
        <p>
          No fake maps here. LTE and 5G get an instant answer; for fibre we
          check with the network operators and confirm within one business
          day.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-2xl px-4 py-12">

      {result === "lte-available" ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <p className="flex items-center gap-2 font-medium text-emerald-800">
            <CheckCircle2 className="size-5" aria-hidden />
            Good news, LTE/5G is available in your area.
          </p>
          <p className="mt-2 text-sm text-emerald-800/80">
            MTN, Vodacom and Telkom LTE cover most of South Africa. Exact
            speeds depend on signal strength at your address and network load, that&apos;s true for every provider, and we&apos;d rather tell you
            upfront. 5G needs 5G coverage in your suburb; your router falls
            back to 4G where it&apos;s limited.
          </p>
          <Link
            href="/internet"
            className="mt-3 inline-flex touch-target items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Browse LTE & 5G plans
          </Link>
        </div>
      ) : null}

      {result === "fibre-promised" ? (
        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-5">
          <p className="flex items-center gap-2 font-medium text-blue-800">
            <MessageCircle className="size-5" aria-hidden />
            We&apos;re on it.
          </p>
          <p className="mt-2 text-sm text-blue-800/80">
            We confirm fibre availability at your address within one business
            day, on WhatsApp. If more than one network reaches you, we&apos;ll
            send the options with honest pros and cons.
          </p>
        </div>
      ) : null}

      {result === "missing" ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          For a fibre check we need your name, cellphone number and address, that&apos;s who we send the confirmation to.
        </p>
      ) : null}
      {result === "invalid-phone" ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          That cellphone number doesn&apos;t look right, please check it and
          try again.
        </p>
      ) : null}

      <div className="mt-8 flex gap-2" role="tablist" aria-label="Service type">
        <Link
          href="/coverage?kind=lte"
          role="tab"
          aria-selected={kind === "lte"}
          className={
            kind === "lte"
              ? "rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
              : "rounded-full border px-5 py-2 text-sm text-muted-foreground hover:bg-accent"
          }
        >
          LTE / 5G
        </Link>
        <Link
          href="/coverage?kind=fibre"
          role="tab"
          aria-selected={kind === "fibre"}
          className={
            kind === "fibre"
              ? "rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
              : "rounded-full border px-5 py-2 text-sm text-muted-foreground hover:bg-accent"
          }
        >
          Fibre
        </Link>
      </div>

      <form action={coverageCheckAction} className="mt-6 space-y-4">
        <input type="hidden" name="kind" value={kind} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Your name{kind === "lte" ? " (optional)" : ""}
            </Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required={kind === "fibre"}
            />
            <p className="text-xs text-muted-foreground">
              So we know who to confirm with.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">
              Cellphone{kind === "lte" ? " (optional)" : ""}
            </Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="082 123 4567"
              required={kind === "fibre"}
            />
            <p className="text-xs text-muted-foreground">
              We confirm on WhatsApp, no marketing without your say-so.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="line1">Street address</Label>
          <Input
            id="line1"
            name="line1"
            autoComplete="address-line1"
            required={kind === "fibre"}
            placeholder="12 Protea Road"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="suburb">Suburb</Label>
            <Input id="suburb" name="suburb" autoComplete="address-level3" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              name="city"
              autoComplete="address-level2"
              required={kind === "fibre"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input id="postalCode" name="postalCode" autoComplete="postal-code" />
          </div>
        </div>
        <button
          type="submit"
          className="flex w-full touch-target items-center justify-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91] sm:w-auto"
        >
          {kind === "fibre" ? "Check fibre at my address" : "Check LTE/5G coverage"}
        </button>
      </form>
      </div>
    </>
  );
}
