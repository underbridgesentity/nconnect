"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  acceptOtpRequestAction,
  acceptVerifyAction,
  acceptFinalizeAction,
} from "./actions";

function formatR(cents: number) {
  const rands = cents / 100;
  return Number.isInteger(rands)
    ? `R${rands.toLocaleString("en-ZA")}`
    : `R${rands.toFixed(2)}`;
}

export function AcceptFlow({
  token,
  prefill,
  totalCents,
}: {
  token: string;
  prefill: { name: string; phone: string; email: string; requiresRica: boolean };
  totalCents: number;
}) {
  const [phase, setPhase] = useState<"contact" | "otp" | "details" | "paying">(
    "contact"
  );
  const [contact, setContact] = useState(prefill);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{
    actionUrl: string;
    fields: Record<string, string>;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {phase === "contact" ? (
        <form
          className="space-y-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              setContact({
                name: String(form.get("name")),
                phone: String(form.get("phone")),
                email: String(form.get("email") ?? ""),
                requiresRica: prefill.requiresRica,
              });
              const r = await acceptOtpRequestAction(token, form);
              if (r.ok) setPhase("otp");
              else setError(r.error ?? "Failed");
            })
          }
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" defaultValue={prefill.name} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Cellphone number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={prefill.phone}
              required
            />
            <p className="text-xs text-muted-foreground">
              We verify it with a 6-digit code, it becomes your sign-in.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email (for invoices)</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={prefill.email}
            />
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
            startTransition(async () => {
              setError(null);
              const r = await acceptVerifyAction(token, form);
              if (r.ok && r.customerId) {
                setCustomerId(r.customerId);
                setPhase("details");
              } else setError(r.error ?? "Failed");
            })
          }
        >
          <input type="hidden" name="phone" value={contact.phone} />
          <input type="hidden" name="name" value={contact.name} />
          <input type="hidden" name="email" value={contact.email} />
          <div className="space-y-1.5">
            <Label htmlFor="code">Enter the 6-digit code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              className="touch-target text-center font-mono text-lg tracking-[0.4em]"
            />
            <p className="text-xs text-muted-foreground">
              Sent to {contact.phone}.
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm">
            <Checkbox name="popiaConsent" className="mt-0.5" />
            <span>
              I consent to Needd Connect processing my information to provide
              and bill my services (required).
            </span>
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Checking…" : "Continue"}
          </Button>
        </form>
      ) : null}

      {phase === "details" || phase === "paying" ? (
        <form
          className="space-y-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              const r = await acceptFinalizeAction(token, form);
              if (r.ok && r.actionUrl && r.fields) {
                setCheckout({ actionUrl: r.actionUrl, fields: r.fields });
                setPhase("paying");
              } else setError(r.error ?? "Failed");
            })
          }
        >
          <input type="hidden" name="customerId" value={customerId ?? ""} />
          <input type="hidden" name="name" value={contact.name} />
          <input type="hidden" name="email" value={contact.email} />
          <h2 className="font-semibold">Where should the service live?</h2>
          <div className="space-y-1.5">
            <Label htmlFor="line1">Street address</Label>
            <Input id="line1" name="line1" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="suburb">Suburb</Label>
              <Input id="suburb" name="suburb" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input id="postalCode" name="postalCode" className="w-32" />
          </div>

          {contact.requiresRica ? (
            <div className="space-y-3 rounded-lg border bg-card p-3">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                Your quote includes a SIM, RICA (SA law) needs your ID and
                proof of address. Phone photos are fine; stored encrypted.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="idNumber">SA ID or passport number</Label>
                <Input id="idNumber" name="idNumber" required autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idDoc">ID document photo</Label>
                <Input id="idDoc" name="idDoc" type="file" accept="image/*,.pdf" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="poaDoc">Proof of address (under 3 months)</Label>
                <Input id="poaDoc" name="poaDoc" type="file" accept="image/*,.pdf" required />
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            type="submit"
            className="w-full touch-target"
            disabled={pending || phase === "paying"}
          >
            {pending
              ? "Preparing secure payment…"
              : `Pay ${formatR(totalCents)} securely`}
          </Button>
        </form>
      ) : null}

      {checkout ? (
        <form
          action={checkout.actionUrl}
          method="post"
          ref={(form) => {
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
      ) : null}
    </div>
  );
}
