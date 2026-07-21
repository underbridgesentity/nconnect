"use client";

import { useState, useTransition } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  requestSignupOtpAction,
  verifySignupOtpAction,
  submitRicaAction,
  createOrderAction,
  getCheckoutAction,
} from "./actions";

/**
 * Step 3 (spec §9.2): contact + inline OTP (creates the account), POPIA
 * consent, conditional RICA capture, order review, PayFast redirect.
 */

function formatR(cents: number) {
  const rands = cents / 100;
  return Number.isInteger(rands)
    ? `R${rands.toLocaleString("en-ZA")}`
    : `R${rands.toFixed(2)}`;
}

type Summary = {
  lines: { name: string; qty: number; totalCents: number }[];
  totalDueNowCents: number;
  monthlyCents: number;
};

export function StepThree({
  contact,
  phoneVerified,
  requiresRica,
  ricaDone,
  orderCreated,
  summary,
}: {
  contact: { name: string; phone: string; email?: string } | null;
  phoneVerified: boolean;
  requiresRica: boolean;
  ricaDone: boolean;
  orderCreated: boolean;
  summary: Summary | null;
}) {
  const [phase, setPhase] = useState<
    "contact" | "otp" | "rica" | "review" | "paying"
  >(
    phoneVerified
      ? requiresRica && !ricaDone
        ? "rica"
        : "review"
      : contact
        ? "otp"
        : "contact"
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [checkout, setCheckout] = useState<{
    actionUrl: string;
    fields: Record<string, string>;
  } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, onOk: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.ok) onOk();
      else setError(result.error ?? "Something went wrong");
    });

  if (!summary) {
    return (
      <p className="mt-6 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Your selection has expired, {" "}
        <a href="/signup?step=1" className="text-primary hover:underline">
          choose a plan
        </a>{" "}
        to continue.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {phase === "contact" ? (
        <form
          className="space-y-4"
          action={(form) =>
            run(() => requestSignupOtpAction(form), () => setPhase("otp"))
          }
        >
          <h2 className="font-semibold">Your details</h2>
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" autoComplete="name" required
              defaultValue={contact?.name} />
            <p className="text-xs text-muted-foreground">
              As on your ID, we use it for your account and invoices.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Cellphone number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="082 123 4567"
              required
              defaultValue={contact?.phone}
            />
            <p className="text-xs text-muted-foreground">
              Your sign-in and where order updates arrive (WhatsApp).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={contact?.email}
            />
            <p className="text-xs text-muted-foreground">
              For invoices and receipts, recommended.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Sending code…" : "Verify my number"}
          </Button>
        </form>
      ) : null}

      {phase === "otp" ? (
        <form
          className="space-y-4"
          action={(form) =>
            run(
              () => verifySignupOtpAction(form),
              () => setPhase(requiresRica && !ricaDone ? "rica" : "review")
            )
          }
        >
          <h2 className="font-semibold">Enter the 6-digit code</h2>
          <p className="text-sm text-muted-foreground">
            Sent to {contact?.phone}. This creates your Needd Connect account.
          </p>
          <Input
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            className="touch-target text-center font-mono text-lg tracking-[0.4em]"
            aria-label="6-digit code"
          />
          <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            <label className="flex items-start gap-2">
              <Checkbox name="popiaConsent" className="mt-0.5" />
              <span>
                I consent to Needd Connect processing my information to provide
                and bill my services (required, {" "}
                <a
                  href="/legal/popia"
                  target="_blank"
                  className="text-primary hover:underline"
                >
                  POPIA notice
                </a>
                ).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox name="marketingWhatsapp" className="mt-0.5" />
              <span className="text-muted-foreground">
                Send me deals on WhatsApp (optional).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox name="marketingEmail" className="mt-0.5" />
              <span className="text-muted-foreground">
                Send me deals by email (optional).
              </span>
            </label>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Checking…" : "Create my account"}
          </Button>
          <button
            type="button"
            onClick={() => setPhase("contact")}
            className="w-full text-center text-xs text-muted-foreground hover:underline"
          >
            Wrong number? Go back
          </button>
        </form>
      ) : null}

      {phase === "rica" ? (
        <form
          className="space-y-4"
          action={(form) =>
            run(() => submitRicaAction(form), () => setPhase("review"))
          }
        >
          <div className="flex items-start gap-2 rounded-lg border bg-card p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Your order includes a SIM, and South African law (RICA) requires
              ID verification before activation. Photos from your phone camera
              are fine. Stored encrypted, used only for RICA.{" "}
              <a
                href="/legal/rica"
                target="_blank"
                className="text-primary hover:underline"
              >
                More about RICA
              </a>
              .
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idNumber">SA ID or passport number</Label>
            <Input id="idNumber" name="idNumber" required autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idDoc">Photo of your ID document</Label>
            <Input
              id="idDoc"
              name="idDoc"
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="poaDoc">
              Proof of address (bank statement, municipal bill or lease, under
              3 months old)
            </Label>
            <Input
              id="poaDoc"
              name="poaDoc"
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Uploading…" : "Save RICA details"}
          </Button>
        </form>
      ) : null}

      {phase === "review" || phase === "paying" ? (
        <div className="space-y-4">
          <h2 className="font-semibold">Review your order</h2>
          <div className="rounded-lg border bg-card">
            {summary.lines.map((line, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b p-3 text-sm last:border-0"
              >
                <span>
                  {line.name}
                  {line.qty > 1 ? ` × ${line.qty}` : ""}
                </span>
                <span className="tnum font-mono">{formatR(line.totalCents)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between p-3 font-semibold">
              <span>Due now</span>
              <span className="tnum font-mono">
                {formatR(summary.totalDueNowCents)}
              </span>
            </div>
            {summary.monthlyCents > 0 ? (
              <p className="border-t p-3 text-xs text-muted-foreground">
                Includes your first month. From activation, billing is{" "}
                {formatR(summary.monthlyCents)}/month on your activation date.
              </p>
            ) : null}
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 text-primary" aria-hidden />
              Secure card payment via PayFast
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 text-primary" aria-hidden />
              Your paid month starts when the service is activated, not today
            </li>
          </ul>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            className="w-full touch-target"
            disabled={pending || phase === "paying"}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                if (!orderCreated) {
                  const created = await createOrderAction();
                  if (!created.ok) {
                    setError(created.error ?? "Could not create the order");
                    return;
                  }
                }
                const co = await getCheckoutAction();
                if (!co.ok) {
                  setError(co.error);
                  return;
                }
                setCheckout({ actionUrl: co.actionUrl, fields: co.fields });
                setPhase("paying");
              })
            }
          >
            {pending
              ? "Preparing secure payment…"
              : `Pay ${formatR(summary.totalDueNowCents)} securely`}
          </Button>
        </div>
      ) : null}

      {checkout ? <PayfastRedirect checkout={checkout} /> : null}
    </div>
  );
}

function PayfastRedirect({
  checkout,
}: {
  checkout: { actionUrl: string; fields: Record<string, string> };
}) {
  return (
    <form
      action={checkout.actionUrl}
      method="post"
      ref={(form) => {
        // Auto-submit once mounted; the visible button covers no-JS races.
        if (form) setTimeout(() => form.submit(), 150);
      }}
    >
      {Object.entries(checkout.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className="text-center text-sm text-muted-foreground">
        Taking you to PayFast…{" "}
        <button type="submit" className="text-primary hover:underline">
          Continue manually
        </button>
      </p>
    </form>
  );
}
