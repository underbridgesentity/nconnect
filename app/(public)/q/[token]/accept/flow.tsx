"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCents } from "@/lib/money";
import {
  acceptOtpRequestAction,
  acceptVerifyAction,
  acceptFinalizeAction,
} from "./actions";

type Phase = "contact" | "otp" | "details" | "paying";
type Contact = { name: string; phone: string; email: string; requiresRica: boolean };

export function AcceptFlow({
  token,
  prefill,
  totalCents,
}: {
  token: string;
  prefill: Contact;
  totalCents: number;
}) {
  const [phase, setPhase] = useState<Phase>("contact");
  const [contact, setContact] = useState<Contact>(prefill);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [checkout, setCheckout] = useState<{
    actionUrl: string;
    fields: Record<string, string>;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [resending, startResend] = useTransition();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoredRef = useRef(false);
  const storageKey = `nc:quote-accept:${token}`;

  // Reloading during the document upload step used to restart the whole flow.
  //
  // sessionStorage cannot be read during the server render, so the restore has
  // to happen once after mount. That is the documented exception to the
  // no-setState-in-effect rule: reading an external store on hydration.
  useEffect(() => {
    let saved: {
      phase?: Phase;
      contact?: Contact;
      customerId?: string | null;
    } | null = null;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      // Storage blocked or corrupt: start at the beginning, nothing is lost.
    }
    restoredRef.current = true;
    if (!saved) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved.contact) setContact({ ...prefill, ...saved.contact });
    if (saved.customerId) setCustomerId(saved.customerId);
    // "paying" is never restored: the PayFast form has to be rebuilt.
    if (saved.phase === "otp" || (saved.phase === "details" && saved.customerId)) {
      setPhase(saved.phase);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({ phase, contact, customerId })
      );
    } catch {
      // Nothing to persist to, the flow still works in memory.
    }
  }, [phase, contact, customerId, storageKey]);

  // Moving the heading into focus is what tells a screen reader the step
  // changed; without it focus falls to document.body when the form unmounts.
  useEffect(() => {
    if (phase === "contact") return;
    headingRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const clearStorage = useCallback(() => {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // nothing to clean up
    }
  }, [storageKey]);

  const resend = () =>
    startResend(async () => {
      setError(null);
      setNotice(null);
      const form = new FormData();
      form.set("name", contact.name);
      form.set("phone", contact.phone);
      form.set("email", contact.email);
      const r = await acceptOtpRequestAction(token, form);
      if (r.ok) {
        setNotice(`A new code is on its way to ${contact.email}.`);
        setCooldown(r.resendIn);
      } else {
        setError(r.error ?? "We could not send another code");
      }
    });

  const errorBlock = error ? (
    <p id="accept-error" role="alert" className="text-sm font-medium text-destructive">
      {error}
    </p>
  ) : null;

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="sr-only">
        {phase === "contact"
          ? "Step 1 of 3, your details"
          : phase === "otp"
            ? "Step 2 of 3, verify your email address"
            : "Step 3 of 3, address and payment"}
      </p>

      {phase === "contact" ? (
        <form
          className="space-y-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              setNotice(null);
              setContact({
                name: String(form.get("name")),
                phone: String(form.get("phone")),
                email: String(form.get("email") ?? ""),
                requiresRica: prefill.requiresRica,
              });
              const r = await acceptOtpRequestAction(token, form);
              if (r.ok) {
                setPhase("otp");
                setCooldown(r.resendIn);
              } else setError(r.error ?? "Failed");
            })
          }
        >
          <h2 ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
            Your details
          </h2>
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              name="name"
              defaultValue={contact.name}
              required
              autoComplete="name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={contact.email}
              required
              autoComplete="email"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "accept-error email-hint" : "email-hint"}
            />
            <p id="email-hint" className="text-xs text-muted-foreground">
              We verify it with a 6-digit code, and it becomes your sign-in.
              Invoices come here too.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Cellphone number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={contact.phone}
              required
              autoComplete="tel"
              aria-describedby="phone-hint"
            />
            <p id="phone-hint" className="text-xs text-muted-foreground">
              RICA requires a contactable number for any SIM-based service, so
              we need it even though you sign in with your email.
            </p>
          </div>
          {errorBlock}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Sending code…" : "Email me a code"}
          </Button>
        </form>
      ) : null}

      {phase === "otp" ? (
        <form
          className="space-y-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              setNotice(null);
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
          <h2 ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
            Enter the 6-digit code
          </h2>
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "accept-error code-hint" : "code-hint"}
              className="touch-target text-center font-mono text-lg tracking-[0.4em]"
            />
            <p id="code-hint" className="text-xs text-muted-foreground">
              Sent to {contact.email}.
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-2xl border bg-card p-3 text-sm">
            <Checkbox name="popiaConsent" className="mt-0.5" />
            <span>
              I consent to Needd Connect processing my information to provide
              and bill my services (required).
            </span>
          </label>
          {notice ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {errorBlock}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Checking…" : "Continue"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0 || resending}
              className="touch-target rounded-full px-3 font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              {resending
                ? "Sending…"
                : cooldown > 0
                  ? `Resend code in ${cooldown}s`
                  : "Send the code again"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
                setPhase("contact");
              }}
              className="touch-target rounded-full px-3 text-muted-foreground hover:text-foreground hover:underline"
            >
              Wrong email address? Change it
            </button>
          </div>
        </form>
      ) : null}

      {phase === "details" || phase === "paying" ? (
        <form
          className="space-y-4"
          action={(form) =>
            startTransition(async () => {
              setError(null);
              setNotice(null);
              const r = await acceptFinalizeAction(token, form);
              if (r.ok && r.actionUrl && r.fields) {
                clearStorage();
                setCheckout({ actionUrl: r.actionUrl, fields: r.fields });
                setPhase("paying");
              } else setError(r.error ?? "Failed");
            })
          }
        >
          <input type="hidden" name="customerId" value={customerId ?? ""} />
          <input type="hidden" name="name" value={contact.name} />
          <input type="hidden" name="email" value={contact.email} />
          <h2 ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
            Where should the service live?
          </h2>
          <div className="space-y-1.5">
            <Label htmlFor="line1">Street address</Label>
            <Input id="line1" name="line1" required autoComplete="address-line1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="suburb">Suburb</Label>
              <Input id="suburb" name="suburb" autoComplete="address-level3" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" required autoComplete="address-level2" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input
              id="postalCode"
              name="postalCode"
              className="w-32"
              autoComplete="postal-code"
            />
          </div>

          {contact.requiresRica ? (
            <div className="space-y-3 rounded-2xl border bg-card p-3">
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

          {errorBlock}
          <Button
            type="submit"
            className="w-full touch-target"
            disabled={pending || phase === "paying"}
            aria-describedby={error ? "accept-error" : undefined}
          >
            {pending
              ? "Preparing secure payment…"
              : `Pay ${formatCents(totalCents)} securely`}
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
          <p aria-live="polite" className="text-center text-sm text-muted-foreground">
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
