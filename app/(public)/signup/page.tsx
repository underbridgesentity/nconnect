import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  publishedPlans,
  publishedPlanBySlug,
  publishedBundleBySlug,
  publishedHardware,
} from "@/lib/domain/catalogue";
import { priceCart, type PricedCart } from "@/lib/domain/orders";
import { readDraft } from "@/lib/domain/signup";
import { getSetting } from "@/lib/domain/settings";
import { multiply } from "@/lib/money";
import { MoneyText } from "@/components/shared/money-text";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  chooseSelectionAction,
  toggleHardwareAction,
  continueToAddressAction,
  submitAddressAction,
  fibreFeasibilityAction,
} from "./actions";
import { PendingCard, PendingSubmit } from "./pending-button";
import { StepThree } from "./step-three";

export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false },
};

const PRIMARY_CTA =
  "flex w-full touch-target items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91]";

const OTP_TTL_SECONDS = 5 * 60;
const OTP_RESEND_SECONDS = 60;

/** Absolute deadline in epoch ms, so the client never has to guess a clock. */
function deadline(sentAt: string | undefined, window: number): number | null {
  if (!sentAt) return null;
  const sent = new Date(sentAt).getTime();
  if (Number.isNaN(sent)) return null;
  return sent + window * 1000;
}

function StepHeader({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Choose", "Address", "You & payment"];
  return (
    <ol className="flex items-center gap-2" aria-label="Signup progress">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        return (
          <li
            key={label}
            className="flex flex-1 items-center gap-2"
            aria-current={n === current ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                n < current
                  ? "bg-primary text-primary-foreground"
                  : n === current
                    ? "border-2 border-primary text-primary"
                    : "border text-muted-foreground"
              )}
            >
              {n < current ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <span aria-hidden>{n}</span>
              )}
            </span>
            {/* Labels stay in the accessibility tree on phones, where
                `hidden` would leave three unnamed circles. */}
            <span
              className={cn(
                "sr-only text-xs font-medium sm:not-sr-only sm:inline",
                n === current ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <span className="sr-only">
                {n < current
                  ? "Completed: "
                  : n === current
                    ? "Current step: "
                    : "Not started: "}
              </span>
              {label}
            </span>
            {i < steps.length - 1 ? (
              <span className="h-px flex-1 bg-border" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const HW_SUGGESTIONS: Record<string, string[]> = {
  lte_home: ["router_lte", "router_5g", "power"],
  telkom_lte: ["router_lte", "power"],
  sim_data: ["router_lte"],
  fibre: ["router_fibre", "mesh", "power"],
  voip: ["voip_phone"],
};

/** Honest availability, from the same column the warehouse works off. */
function stockNote(stockQty: number, qty: number): string {
  if (stockQty >= qty) return "In stock, delivered within 3 business days";
  return "Not in stock today, we confirm the delivery date with you before we ship";
}

export default async function SignupWizardPage({
  searchParams,
}: {
  searchParams: Promise<{
    step?: string;
    plan?: string;
    bundle?: string;
    fibre?: string;
    error?: string;
    fields?: string;
  }>;
}) {
  const params = await searchParams;
  const stored = await readDraft();
  const company = await getSetting<{ phone: string }>("company");

  // Deep links (?plan= / ?bundle=) preselect without touching the draft, // cookies can't be written during render; persistence happens when the
  // visitor takes an action (spec §9.2).
  const draft = {
    ...stored,
    ...(params.plan ? { planSlug: params.plan, bundleSlug: undefined } : {}),
    ...(params.bundle ? { bundleSlug: params.bundle, planSlug: undefined } : {}),
  };

  // A deep link that changes the selection (clicking "Sign up" on another
  // plan page) must land on step 1, not on review: the new choice is only
  // persisted when the visitor acts on it, and paying against a draft that
  // still holds the old plan is exactly how the wrong amount gets charged.
  const deepLinkChangesSelection = Boolean(
    (params.plan && params.plan !== stored.planSlug) ||
      (params.bundle && params.bundle !== stored.bundleSlug)
  );

  // Step 3 needs an address: reaching payment without one used to strand the
  // customer with "We need your address" and no way to give us one.
  const hasSelection = Boolean(draft.planSlug || draft.bundleSlug);
  const maxStep: 1 | 2 | 3 = deepLinkChangesSelection
    ? 1
    : draft.address
      ? 3
      : hasSelection
        ? 2
        : 1;
  const requested = Number(params.step ?? draft.step ?? 1);
  const step = (
    Number.isFinite(requested) ? Math.min(Math.max(requested, 1), maxStep) : 1
  ) as 1 | 2 | 3;

  const selectedPlan = draft.planSlug
    ? await publishedPlanBySlug(draft.planSlug)
    : null;
  const selectedBundle = draft.bundleSlug
    ? await publishedBundleBySlug(draft.bundleSlug)
    : null;
  // Fibre cannot be bought on the spot, so say so before the address form,
  // not after it.
  const isFibre =
    selectedPlan?.category === "fibre" ||
    Boolean(selectedBundle?.items.some((i) => i.plan?.category === "fibre"));

  // Two very different failures: the catalogue changed under the customer, or
  // our infrastructure is unwell. Never tell someone their choice expired
  // because the database blinked.
  let priced: PricedCart | null = null;
  let pricingError: "unavailable" | "system" | null = null;
  if (draft.planSlug || draft.bundleSlug) {
    try {
      priced = await priceCart({
        planSlugs: draft.planSlug ? [draft.planSlug] : [],
        hardware: draft.hardware ?? [],
        bundleSlug: draft.bundleSlug ?? null,
      });
    } catch (err) {
      const known =
        err instanceof Error && /no longer available|Nothing in the order/i.test(err.message);
      if (!known) console.error("signup pricing failed:", err);
      pricingError = known ? "unavailable" : "system";
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 pb-36">
      <h1 className="text-2xl font-semibold tracking-tight">
        Let&apos;s get you connected
      </h1>
      <div className="mt-4">
        <StepHeader current={step} />
      </div>

      {pricingError === "system" ? (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          We are having trouble loading prices right now. Your selection is
          saved, please try again in a moment. Nothing has been charged.
        </p>
      ) : null}
      {pricingError === "unavailable" ? (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Something in your order is no longer available.{" "}
          <Link href="/signup?step=1" className="font-medium underline">
            Choose again
          </Link>{" "}
          and we will price it fresh.
        </p>
      ) : null}

      {step === 1 ? (
        <Step1Choose
          draft={draft}
          selectedPlanName={selectedPlan?.name ?? selectedBundle?.name ?? null}
          selectedCategory={selectedPlan?.category ?? null}
          selectedOnceOffCents={selectedPlan?.onceOffCents ?? 0}
          isFibre={isFibre}
        />
      ) : null}

      {step === 2 ? (
        <Step2Address
          fibre={params.fibre === "1"}
          isFibre={isFibre}
          error={params.error}
          fields={params.fields}
          draft={draft}
        />
      ) : null}

      {step === 3 ? (
        <StepThree
          contact={draft.contact ?? null}
          phoneVerified={Boolean(draft.phoneVerified)}
          requiresRica={Boolean(priced?.requiresRica)}
          ricaDone={Boolean(draft.ricaIdDocPath && draft.ricaPoaDocPath)}
          ricaIdSaved={Boolean(draft.ricaIdDocPath)}
          ricaPoaSaved={Boolean(draft.ricaPoaDocPath)}
          address={draft.address ?? null}
          supportPhone={company?.phone ?? null}
          otpSent={Boolean(draft.otpSentAt)}
          otpExpiresAt={deadline(draft.otpSentAt, OTP_TTL_SECONDS)}
          otpResendAt={deadline(draft.otpSentAt, OTP_RESEND_SECONDS)}
          summary={
            priced
              ? {
                  lines: priced.lines.map((l) => ({
                    name: l.name,
                    qty: l.qty,
                    totalCents: multiply(l.unitPriceCents, l.qty),
                    components: l.components,
                    stockNote:
                      l.itemType === "hardware"
                        ? stockNote(l.stockQty ?? 0, l.qty)
                        : undefined,
                  })),
                  totalDueNowCents: priced.totalDueNowCents,
                  monthlyCents: priced.monthlyCents,
                }
              : null
          }
        />
      ) : null}

      {/* Running total pinned bottom (spec §9.2) */}
      {priced ? (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
            <div className="text-sm">
              <span className="text-muted-foreground">Due now: </span>
              <MoneyText
                cents={priced.totalDueNowCents}
                className="font-semibold"
              />
            </div>
            {priced.monthlyCents > 0 ? (
              <div className="text-xs text-muted-foreground">
                then <MoneyText cents={priced.monthlyCents} whole />
                /month from activation
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- step 1

async function Step1Choose({
  draft,
  selectedPlanName,
  selectedCategory,
  selectedOnceOffCents,
  isFibre,
}: {
  draft: Awaited<ReturnType<typeof readDraft>>;
  selectedPlanName: string | null;
  selectedCategory: string | null;
  selectedOnceOffCents: number;
  isFibre: boolean;
}) {
  const plans = await publishedPlans();
  const hardware = await publishedHardware();
  const suggestionCats = selectedCategory
    ? (HW_SUGGESTIONS[selectedCategory] ?? [])
    : [];
  const suggestions = hardware.filter((h) => suggestionCats.includes(h.category));
  const chosenSkus = new Set((draft.hardware ?? []).map((h) => h.sku));

  const grouped: [string, string, typeof plans][] = [
    ["lte_home", "Home Internet (LTE/5G)", plans.filter((p) => p.category === "lte_home")],
    ["telkom_lte", "Telkom LTE", plans.filter((p) => p.category === "telkom_lte")],
    ["fibre", "Fibre", plans.filter((p) => p.category === "fibre")],
    ["voip", "Business VoIP", plans.filter((p) => p.category === "voip")],
    ["sim_data", "SIM Data (24-month)", plans.filter((p) => p.category === "sim_data")],
  ].filter(([, , list]) => list.length > 0) as [string, string, typeof plans][];

  // Most visitors arrive from one category page. Showing all 26 plans as one
  // wall on a phone buries the decision they already made, so the rest fold
  // away behind a native disclosure that needs no JavaScript.
  const primary = selectedCategory
    ? grouped.filter(([key]) => key === selectedCategory)
    : grouped;
  const secondary = selectedCategory
    ? grouped.filter(([key]) => key !== selectedCategory)
    : [];

  return (
    <div className="mt-6 space-y-8">
      {selectedPlanName ? (
        <div className="rounded-2xl border border-primary/40 bg-accent p-4">
          <p className="text-sm text-accent-foreground">
            <span className="font-semibold">{selectedPlanName}</span> selected.
            Change it below or continue.
          </p>
          {isFibre ? (
            <p className="mt-2 text-sm text-accent-foreground/90">
              Fibre is confirmed with the network operator at your address
              first, usually within one business day. We take your address
              next, and nothing is charged until availability is confirmed.
            </p>
          ) : null}
          <form action={continueToAddressAction} className="mt-3">
            {draft.planSlug ? (
              <input type="hidden" name="planSlug" value={draft.planSlug} />
            ) : null}
            {draft.bundleSlug ? (
              <input type="hidden" name="bundleSlug" value={draft.bundleSlug} />
            ) : null}
            <PendingSubmit
              pendingLabel="Loading..."
              className="flex touch-target items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-[#0f5a91]"
            >
              Continue to address
            </PendingSubmit>
          </form>
        </div>
      ) : (
        <p className="text-muted-foreground">Pick your plan to get started.</p>
      )}

      {primary.map(([, title, groupPlans]) => (
        <PlanGroup
          key={title}
          title={title}
          groupPlans={groupPlans}
          selectedSlug={draft.planSlug}
        />
      ))}

      {secondary.length > 0 ? (
        <details className="rounded-2xl border bg-card p-4">
          <summary className="cursor-pointer touch-target list-none text-sm font-medium">
            See the other categories
          </summary>
          <div className="mt-4 space-y-8">
            {secondary.map(([, title, groupPlans]) => (
              <PlanGroup
                key={title}
                title={title}
                groupPlans={groupPlans}
                selectedSlug={draft.planSlug}
              />
            ))}
          </div>
        </details>
      ) : null}

      {suggestions.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">
            Add the right hardware
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedCategory === "lte_home"
              ? "MTN/Vodacom LTE needs a network-approved router, pick one below if you don't have one."
              : "Optional, add what you need, skip what you don't."}
          </p>
          {selectedOnceOffCents > 0 ? (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Your plan already carries a once-off{" "}
              <MoneyText cents={selectedOnceOffCents} whole /> charge. If you
              are not sure whether that covers your router, ask us before adding
              one here, we would rather you paid once.
            </p>
          ) : null}
          <div className="mt-2 space-y-2">
            {suggestions.map((h) => {
              const chosen = chosenSkus.has(h.sku);
              return (
                <form key={h.id} action={toggleHardwareAction}>
                  <input type="hidden" name="sku" value={h.sku} />
                  <PendingCard
                    className={cn(
                      "w-full rounded-2xl border p-3 text-left",
                      chosen
                        ? "border-primary bg-accent"
                        : "bg-card hover:border-primary/40"
                    )}
                  >
                    <span className="sr-only">
                      {chosen ? "Remove from order: " : "Add to order: "}
                    </span>
                    <span className="flex items-center justify-between gap-3">
                      <span>
                        <span className="text-sm font-medium">{h.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {h.description}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {h.stockQty > 0
                            ? "In stock, delivered within 3 business days"
                            : "Not in stock today, we confirm the delivery date before we ship"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <MoneyText cents={h.priceCents} whole className="text-sm" />
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full border",
                            chosen && "border-primary bg-primary text-primary-foreground"
                          )}
                        >
                          {chosen ? <Check className="size-3" aria-hidden /> : null}
                        </span>
                      </span>
                    </span>
                  </PendingCard>
                </form>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedPlanName ? (
        <form action={continueToAddressAction}>
          {draft.planSlug ? (
            <input type="hidden" name="planSlug" value={draft.planSlug} />
          ) : null}
          {draft.bundleSlug ? (
            <input type="hidden" name="bundleSlug" value={draft.bundleSlug} />
          ) : null}
          <PendingSubmit pendingLabel="Loading..." className={PRIMARY_CTA}>
            Continue to address
          </PendingSubmit>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- step 2

function Step2Address({
  fibre,
  isFibre,
  error,
  fields,
  draft,
}: {
  /** The feasibility panel, shown after the address is captured. */
  fibre: boolean;
  /** The chosen plan is fibre, so this address starts a check, not an order. */
  isFibre: boolean;
  error?: string;
  fields?: string;
  draft: Awaited<ReturnType<typeof readDraft>>;
}) {
  if (fibre) {
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold text-blue-900">
            Fibre needs one extra check
          </h2>
          <p className="mt-1 text-sm text-blue-800/90">
            We confirm fibre availability at your address with the network
            operator before taking any payment, it takes one business day at
            most. Leave your details and we&apos;ll come back to you on
            WhatsApp with a yes (and next steps) or honest alternatives.
          </p>
        </div>
        {error === "contact" ? (
          <p className="text-sm text-destructive">
            We need your name and cellphone number to confirm with you.
          </p>
        ) : null}
        {error === "phone" ? (
          <p className="text-sm text-destructive">
            That cellphone number doesn&apos;t look right. South African
            numbers look like 082 123 4567.
          </p>
        ) : null}
        {error === "name" ? (
          <p className="text-sm text-destructive">
            Please give us your full name so we know who to confirm with.
          </p>
        ) : null}
        {error === "system" ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            We could not save your request just now, and that one is on us.
            Nothing was lost, please try again in a moment or message us on
            WhatsApp and we will pick it up straight away.
          </p>
        ) : null}
        <form action={fibreFeasibilityAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                defaultValue={draft.contact?.name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Cellphone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                required
                defaultValue={draft.contact?.phone}
              />
            </div>
          </div>
          <PendingSubmit
            pendingLabel="Sending your details..."
            className={PRIMARY_CTA}
          >
            Check my address and WhatsApp me
          </PendingSubmit>
        </form>
      </div>
    );
  }

  // Whatever they last typed wins, so a validation error never empties the
  // form on a phone.
  const seed = { ...(draft.address ?? {}), ...(draft.addressInput ?? {}) };
  const missing = new Set((fields ?? "").split(",").filter(Boolean));

  return (
    <div className="mt-6">
      <h2 className="font-semibold">Where should the service live?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isFibre
          ? "Fibre feasibility is per property, so we need the street number. We check with the network operator and come back on WhatsApp within one business day. Nothing is charged before that."
          : "We use this to check coverage and deliver hardware."}
      </p>
      {error === "address" ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {missing.has("line1") && missing.has("city")
            ? "We need the street address and the city."
            : missing.has("city")
              ? "We still need the city."
              : missing.has("line1")
                ? "We still need the street address."
                : "Please check the address, the street address and city are required."}{" "}
          Everything else you typed is still here.
        </p>
      ) : null}
      <form action={submitAddressAction} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="line1">Street address</Label>
          <Input
            id="line1"
            name="line1"
            autoComplete="address-line1"
            defaultValue={seed.line1}
            aria-invalid={missing.has("line1") || undefined}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="line2">Unit / complex (optional)</Label>
          <Input
            id="line2"
            name="line2"
            autoComplete="address-line2"
            defaultValue={seed.line2}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="suburb">Suburb</Label>
            <Input id="suburb" name="suburb" defaultValue={seed.suburb} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              name="city"
              autoComplete="address-level2"
              defaultValue={seed.city}
              aria-invalid={missing.has("city") || undefined}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="province">Province</Label>
            <Input id="province" name="province" defaultValue={seed.province} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input
              id="postalCode"
              name="postalCode"
              autoComplete="postal-code"
              defaultValue={seed.postalCode}
            />
          </div>
        </div>
        <PendingSubmit
          pendingLabel="Checking coverage..."
          className={PRIMARY_CTA}
        >
          {isFibre ? "Check fibre at my address" : "Check coverage and continue"}
        </PendingSubmit>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/signup?step=1" className="hover:underline">
            Back to plans
          </Link>
        </p>
      </form>
    </div>
  );
}

/** One category of plans as tappable cards. */
function PlanGroup({
  title,
  groupPlans,
  selectedSlug,
}: {
  title: string;
  groupPlans: Awaited<ReturnType<typeof publishedPlans>>;
  selectedSlug?: string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {groupPlans.map((p) => {
          const selected = selectedSlug === p.slug;
          return (
            <form key={p.id} action={chooseSelectionAction}>
              <input type="hidden" name="planSlug" value={p.slug} />
              <PendingCard
                className={cn(
                  "w-full rounded-2xl border p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-accent"
                    : "bg-card hover:border-primary/40"
                )}
              >
                <span className="sr-only">
                  {selected ? "Selected: " : "Choose "}
                </span>
                <span className="flex items-center justify-between">
                  <span className="text-sm font-medium">{p.name}</span>
                  {selected ? (
                    <Check className="size-4 text-primary" aria-hidden />
                  ) : null}
                </span>
                <span className="mt-1 block text-sm">
                  <MoneyText cents={p.priceCents} whole />
                  <span className="text-muted-foreground">/month</span>
                </span>
                {p.onceOffCents > 0 ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    plus a once-off <MoneyText cents={p.onceOffCents} whole /> on
                    your first payment
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    No once-off fee
                  </span>
                )}
                {p.dataAllocation ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {p.dataAllocation}
                  </span>
                ) : null}
              </PendingCard>
            </form>
          );
        })}
      </div>
    </section>
  );
}
