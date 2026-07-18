import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  publishedPlans,
  publishedPlanBySlug,
  publishedBundleBySlug,
  publishedHardware,
} from "@/lib/domain/catalogue";
import { priceCart } from "@/lib/domain/orders";
import { readDraft } from "@/lib/domain/signup";
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
import { StepThree } from "./step-three";

export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false },
};

function StepHeader({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Choose", "Address", "You & payment"];
  return (
    <ol className="flex items-center gap-2" aria-label="Signup progress">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
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
              {n < current ? <Check className="size-3.5" /> : n}
            </span>
            <span
              className={cn(
                "hidden text-xs font-medium sm:inline",
                n === current ? "text-foreground" : "text-muted-foreground"
              )}
            >
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

export default async function SignupWizardPage({
  searchParams,
}: {
  searchParams: Promise<{
    step?: string;
    plan?: string;
    bundle?: string;
    fibre?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const stored = await readDraft();

  // Deep links (?plan= / ?bundle=) preselect without touching the draft —
  // cookies can't be written during render; persistence happens when the
  // visitor takes an action (spec §9.2).
  const draft = {
    ...stored,
    ...(params.plan ? { planSlug: params.plan, bundleSlug: undefined } : {}),
    ...(params.bundle ? { bundleSlug: params.bundle, planSlug: undefined } : {}),
  };

  const step = Math.min(
    Number(params.step ?? draft.step ?? 1) as 1 | 2 | 3,
    draft.phoneVerified ? 3 : draft.address ? 3 : draft.planSlug || draft.bundleSlug ? 3 : 1
  ) as 1 | 2 | 3;

  const selectedPlan = draft.planSlug
    ? await publishedPlanBySlug(draft.planSlug)
    : null;
  const selectedBundle = draft.bundleSlug
    ? await publishedBundleBySlug(draft.bundleSlug)
    : null;

  let priced = null;
  if (draft.planSlug || draft.bundleSlug) {
    try {
      priced = await priceCart({
        planSlugs: draft.planSlug ? [draft.planSlug] : [],
        hardware: draft.hardware ?? [],
        bundleSlug: draft.bundleSlug ?? null,
      });
    } catch {
      priced = null;
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 pb-32">
      <h1 className="text-2xl font-semibold tracking-tight">
        Let&apos;s get you connected
      </h1>
      <div className="mt-4">
        <StepHeader current={step} />
      </div>

      {step === 1 ? (
        <Step1Choose
          draft={draft}
          selectedPlanName={selectedPlan?.name ?? selectedBundle?.name ?? null}
          selectedCategory={selectedPlan?.category ?? null}
        />
      ) : null}

      {step === 2 ? (
        <Step2Address
          fibre={params.fibre === "1"}
          error={params.error}
          draft={draft}
        />
      ) : null}

      {step === 3 ? (
        <StepThree
          contact={draft.contact ?? null}
          phoneVerified={Boolean(draft.phoneVerified)}
          requiresRica={Boolean(priced?.requiresRica)}
          ricaDone={Boolean(draft.ricaIdDocPath && draft.ricaPoaDocPath)}
          orderCreated={Boolean(draft.orderId)}
          summary={
            priced
              ? {
                  lines: priced.lines.map((l) => ({
                    name: l.name,
                    qty: l.qty,
                    totalCents: l.unitPriceCents * l.qty,
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
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Due now: </span>
              <MoneyText
                cents={priced.totalDueNowCents}
                className="font-semibold"
              />
              {priced.monthlyCents > 0 ? (
                <span className="ml-2 text-muted-foreground">
                  then <MoneyText cents={priced.monthlyCents} whole />
                  /month
                </span>
              ) : null}
            </div>
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
}: {
  draft: Awaited<ReturnType<typeof readDraft>>;
  selectedPlanName: string | null;
  selectedCategory: string | null;
}) {
  const plans = await publishedPlans();
  const hardware = await publishedHardware();
  const suggestionCats = selectedCategory
    ? (HW_SUGGESTIONS[selectedCategory] ?? [])
    : [];
  const suggestions = hardware.filter((h) => suggestionCats.includes(h.category));
  const chosenSkus = new Set((draft.hardware ?? []).map((h) => h.sku));

  const grouped: [string, typeof plans][] = [
    ["Home Internet (LTE/5G)", plans.filter((p) => p.category === "lte_home")],
    ["Telkom LTE", plans.filter((p) => p.category === "telkom_lte")],
    ["Fibre", plans.filter((p) => p.category === "fibre")],
    ["Business VoIP", plans.filter((p) => p.category === "voip")],
    ["SIM Data (24-month)", plans.filter((p) => p.category === "sim_data")],
  ];

  return (
    <div className="mt-6 space-y-8">
      {selectedPlanName ? (
        <div className="rounded-lg border border-primary/40 bg-accent p-4">
          <p className="text-sm text-accent-foreground">
            <span className="font-semibold">{selectedPlanName}</span> selected.
            Change it below or continue.
          </p>
          <form action={continueToAddressAction} className="mt-3">
            {draft.planSlug ? (
              <input type="hidden" name="planSlug" value={draft.planSlug} />
            ) : null}
            {draft.bundleSlug ? (
              <input type="hidden" name="bundleSlug" value={draft.bundleSlug} />
            ) : null}
            <button
              type="submit"
              className="flex touch-target items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Continue to address
            </button>
          </form>
        </div>
      ) : (
        <p className="text-muted-foreground">Pick your plan to get started.</p>
      )}

      {grouped.map(([title, groupPlans]) =>
        groupPlans.length ? (
          <section key={title}>
            <h2 className="text-sm font-semibold text-muted-foreground">
              {title}
            </h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {groupPlans.map((p) => {
                const selected = draft.planSlug === p.slug;
                return (
                  <form key={p.id} action={chooseSelectionAction}>
                    <input type="hidden" name="planSlug" value={p.slug} />
                    <button
                      type="submit"
                      className={cn(
                        "w-full rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-primary bg-accent"
                          : "bg-card hover:border-primary/40"
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <span className="text-sm font-medium">{p.name}</span>
                        {selected ? (
                          <Check className="size-4 text-primary" aria-hidden />
                        ) : null}
                      </span>
                      <span className="mt-1 block text-sm">
                        <MoneyText cents={p.priceCents} whole />
                        <span className="text-muted-foreground">/month</span>
                        {p.onceOffCents > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            + <MoneyText cents={p.onceOffCents} whole /> once-off
                          </span>
                        ) : null}
                      </span>
                      {p.dataAllocation ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {p.dataAllocation}
                        </span>
                      ) : null}
                    </button>
                  </form>
                );
              })}
            </div>
          </section>
        ) : null
      )}

      {suggestions.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">
            Add the right hardware
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedCategory === "lte_home"
              ? "MTN/Vodacom LTE needs a network-approved router — pick one below if you don't have one."
              : "Optional — add what you need, skip what you don't."}
          </p>
          <div className="mt-2 space-y-2">
            {suggestions.map((h) => {
              const chosen = chosenSkus.has(h.sku);
              return (
                <form key={h.id} action={toggleHardwareAction}>
                  <input type="hidden" name="sku" value={h.sku} />
                  <button
                    type="submit"
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border p-3 text-left",
                      chosen
                        ? "border-primary bg-accent"
                        : "bg-card hover:border-primary/40"
                    )}
                  >
                    <span>
                      <span className="text-sm font-medium">{h.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {h.description}
                      </span>
                    </span>
                    <span className="ml-3 flex items-center gap-2">
                      <MoneyText cents={h.priceCents} whole className="text-sm" />
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border",
                          chosen && "border-primary bg-primary text-primary-foreground"
                        )}
                      >
                        {chosen ? <Check className="size-3" /> : null}
                      </span>
                    </span>
                  </button>
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
          <button
            type="submit"
            className="flex w-full touch-target items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Continue to address
          </button>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- step 2

function Step2Address({
  fibre,
  error,
  draft,
}: {
  fibre: boolean;
  error?: string;
  draft: Awaited<ReturnType<typeof readDraft>>;
}) {
  if (fibre) {
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold text-blue-900">
            Fibre needs one extra check
          </h2>
          <p className="mt-1 text-sm text-blue-800/90">
            We confirm fibre availability at your address with the network
            operator before taking any payment — it takes one business day at
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
            That cellphone number doesn&apos;t look right.
          </p>
        ) : null}
        <form action={fibreFeasibilityAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" autoComplete="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Cellphone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            className="flex w-full touch-target items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Check my address and WhatsApp me
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="font-semibold">Where should the service live?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We use this to check coverage and deliver hardware.
      </p>
      {error === "address" ? (
        <p className="mt-2 text-sm text-destructive">
          Street address and city are required.
        </p>
      ) : null}
      <form action={submitAddressAction} className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="line1">Street address</Label>
          <Input
            id="line1"
            name="line1"
            autoComplete="address-line1"
            defaultValue={draft.address?.line1}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="line2">Unit / complex (optional)</Label>
          <Input
            id="line2"
            name="line2"
            autoComplete="address-line2"
            defaultValue={draft.address?.line2}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="suburb">Suburb</Label>
            <Input
              id="suburb"
              name="suburb"
              defaultValue={draft.address?.suburb}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              name="city"
              autoComplete="address-level2"
              defaultValue={draft.address?.city}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="province">Province</Label>
            <Input
              id="province"
              name="province"
              defaultValue={draft.address?.province}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input
              id="postalCode"
              name="postalCode"
              autoComplete="postal-code"
              defaultValue={draft.address?.postalCode}
            />
          </div>
        </div>
        <button
          type="submit"
          className="flex w-full touch-target items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Check coverage and continue
        </button>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/signup?step=1" className="hover:underline">
            ← Back to plans
          </Link>
        </p>
      </form>
    </div>
  );
}
