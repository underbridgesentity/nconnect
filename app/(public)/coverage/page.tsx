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
  searchParams: Promise<{ result?: string; kind?: string; suburb?: string; callback?: string }>;
}) {
  const { result, kind = "lte", suburb, callback } = await searchParams;
  const isFibre = kind === "fibre";

  return (
    <>
      <PageHeader
        image="/marketing/support.webp"
        imageAlt="A support agent ready to help with a coverage check"
        title="Check coverage at your address"
      >
        <p>
          No fake maps here. For LTE and 5G we tell you what the networks
          actually reach, and what we cannot know from a website. For fibre we
          check with the network operators and confirm within one business day.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-12">
        {result === "lte-available" ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="flex items-center gap-2 font-medium text-emerald-800">
              <CheckCircle2 className="size-5 shrink-0" aria-hidden />
              LTE and 5G plans are available{suburb ? ` in ${suburb}` : ""}.
            </p>
            <div className="mt-2 space-y-2 text-sm text-emerald-800/90">
              <p>
                MTN, Vodacom and Telkom LTE reach almost every South African
                suburb, so you can order today. What nobody can tell you from a
                website, us included, is the signal strength inside your
                specific house: that depends on the distance to the tower, your
                walls and how busy the tower is.
              </p>
              <p>
                The uncapped LTE and 5G plans are month to month with no
                contract. If the signal disappoints once the router is
                installed, tell us straight away and we will work through the
                options with you: a different network, an outdoor antenna, or
                fibre if it reaches you.
              </p>
              <p>
                5G needs 5G in your suburb specifically; where it is thin your
                router falls back to 4G on its own.
              </p>
            </div>
            <Link
              href="/internet"
              className="mt-4 inline-flex touch-target items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91]"
            >
              Browse LTE &amp; 5G plans
            </Link>
          </div>
        ) : null}

        {callback === "failed" ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            We could not save your call-back request just now, that one is on
            us. Message us on WhatsApp and we will pick it up straight away.
          </p>
        ) : null}

        {result === "fibre-promised" ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <p className="flex items-center gap-2 font-medium text-blue-800">
              <MessageCircle className="size-5 shrink-0" aria-hidden />
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
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            For a fibre check we need your name, cellphone number and address,
            that&apos;s who we send the confirmation to.
          </p>
        ) : null}
        {result === "phone" ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            That cellphone number doesn&apos;t look right. South African
            numbers look like 082 123 4567.
          </p>
        ) : null}
        {result === "name" ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Please give us your full name, that&apos;s who we ask for when we
            call.
          </p>
        ) : null}
        {result === "system" ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            We could not save your request just now, and that one is on us.
            Nothing you typed was wrong. Please try again in a moment, or
            message us on WhatsApp and we will pick it up straight away.
          </p>
        ) : null}

        <nav className="flex gap-2" aria-label="Service type">
          <Link
            href="/coverage?kind=lte"
            aria-current={!isFibre ? "page" : undefined}
            className={
              !isFibre
                ? "rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
                : "rounded-full border px-5 py-2 text-sm text-muted-foreground hover:bg-accent"
            }
          >
            LTE / 5G
          </Link>
          <Link
            href="/coverage?kind=fibre"
            aria-current={isFibre ? "page" : undefined}
            className={
              isFibre
                ? "rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
                : "rounded-full border px-5 py-2 text-sm text-muted-foreground hover:bg-accent"
            }
          >
            Fibre
          </Link>
        </nav>

        <form action={coverageCheckAction} className="space-y-4">
          <input type="hidden" name="kind" value={kind} />
          <p className="text-sm text-muted-foreground">
            {isFibre
              ? "Fibre is confirmed with the network operator at your exact address. We come back on WhatsApp within one business day, and nothing is charged before that."
              : "Tell us your suburb and we will point you at the plans that work there. Name and number are optional: leave them and we will check in after installation."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">
                Your name{isFibre ? "" : " (optional)"}
              </Label>
              <Input id="name" name="name" autoComplete="name" required={isFibre} />
              <p className="text-xs text-muted-foreground">
                So we know who to confirm with.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                Cellphone{isFibre ? "" : " (optional)"}
              </Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="082 123 4567"
                required={isFibre}
              />
              <p className="text-xs text-muted-foreground">
                We confirm on WhatsApp, no marketing without your say-so.
              </p>
            </div>
          </div>

          {isFibre ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="line1">Street address</Label>
                <Input
                  id="line1"
                  name="line1"
                  autoComplete="address-line1"
                  required
                  placeholder="12 Protea Road"
                />
                <p className="text-xs text-muted-foreground">
                  Fibre feasibility is per property, so we need the street
                  number.
                </p>
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
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="postalCode">Postal code</Label>
                  <Input
                    id="postalCode"
                    name="postalCode"
                    autoComplete="postal-code"
                  />
                </div>
              </div>
            </>
          ) : (
            // LTE/5G is answered from network footprint, so we only ask for
            // what we actually use. Asking for a street number we ignore is
            // how a coverage checker starts feeling fake.
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="suburb">Suburb</Label>
                <Input
                  id="suburb"
                  name="suburb"
                  autoComplete="address-level3"
                  placeholder="Kempton Park"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" autoComplete="address-level2" />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="flex w-full touch-target items-center justify-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91] sm:w-auto"
          >
            {isFibre ? "Check fibre at my address" : "Check LTE/5G coverage"}
          </button>
        </form>
      </div>
    </>
  );
}
