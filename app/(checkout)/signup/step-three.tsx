"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CreditCard,
  Lock,
  MapPin,
  Pencil,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { PillLink } from "@/components/public/pill";
import { formatCents, multiply, type Cents } from "@/lib/money";
import {
  requestSignupOtpAction,
  resendSignupOtpAction,
  verifySignupOtpAction,
  submitRicaAction,
  startCheckoutAction,
  startNewOrderAction,
  type CheckoutBlock,
} from "./actions";

/**
 * Step 3 (spec §9.2): contact + inline OTP (creates the account), POPIA
 * consent, conditional RICA capture, order review, PayFast redirect.
 *
 * Every field the customer fills in is controlled, so a rejected code, a
 * failed upload or a validation error never empties the form underneath the
 * error message.
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Money on this screen: exact, with the cents dropped only when they are 00. */
const money = (cents: Cents) => formatCents(cents, { whole: true });

type SummaryLine = {
  name: string;
  qty: number;
  totalCents: number;
  components: { label: string; amountCents: number; recurring?: boolean }[];
  stockNote?: string;
};

type Summary = {
  lines: SummaryLine[];
  totalDueNowCents: number;
  monthlyCents: number;
};

type Address = {
  line1: string;
  line2?: string;
  suburb?: string;
  city: string;
  province?: string;
  postalCode?: string;
};

function countdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Seconds remaining until an absolute deadline sent by the server. Anything
 * rendered from this can differ by a second between the server HTML and
 * hydration, so its elements carry suppressHydrationWarning.
 */
function useCountdown(deadlineMs: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!deadlineMs) return 0;
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

export function StepThree({
  contact,
  phoneVerified,
  requiresRica,
  ricaDone,
  ricaIdSaved,
  ricaPoaSaved,
  summary,
  address,
  whatsapp,
  otpSent,
  otpTtlSeconds,
  otpExpiresAt,
  otpResendAt,
}: {
  contact: { name: string; phone: string; email?: string } | null;
  phoneVerified: boolean;
  requiresRica: boolean;
  ricaDone: boolean;
  ricaIdSaved: boolean;
  ricaPoaSaved: boolean;
  summary: Summary | null;
  address: Address | null;
  /** wa.me link, or null when settings carry no WhatsApp-capable mobile. */
  whatsapp: string | null;
  /** A code has actually been sent, so the code screen is the right start. */
  otpSent: boolean;
  /**
   * How long a code lives, handed down from lib/auth/otp. A client component
   * cannot import the OTP module (it is server-only), so the one number the
   * copy quotes travels as a prop rather than as a second copy of the limit.
   */
  otpTtlSeconds: number;
  /** Epoch ms the live code dies, and when a new one may be requested. */
  otpExpiresAt: number | null;
  otpResendAt: number | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<
    "contact" | "otp" | "rica" | "review" | "paying"
  >(
    phoneVerified
      ? requiresRica && !ricaDone
        ? "rica"
        : "review"
      : otpSent
        ? "otp"
        : "contact"
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [block, setBlock] = useState<CheckoutBlock | null>(null);
  const [pending, startTransition] = useTransition();
  const [checkout, setCheckout] = useState<{
    actionUrl: string;
    fields: Record<string, string>;
  } | null>(null);

  // Controlled so nothing is lost when an action comes back with an error.
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [code, setCode] = useState("");
  const [popia, setPopia] = useState(false);
  const [waOptIn, setWaOptIn] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [idNumber, setIdNumber] = useState("");

  const [expiryAt, setExpiryAt] = useState(otpExpiresAt);
  const [resendAt, setResendAt] = useState(otpResendAt);
  const expiresIn = useCountdown(expiryAt);
  const resendIn = useCountdown(resendAt);
  const ttlMinutes = Math.max(1, Math.round(otpTtlSeconds / 60));

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk: () => void
  ) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await fn();
      if (result.ok) onOk();
      else setError(result.error ?? "Something went wrong");
    });

  if (!summary) {
    return (
      <p className="mt-6 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
        We could not price your selection.{" "}
        <Link href="/signup?step=1" className="text-primary hover:underline">
          Choose a plan
        </Link>{" "}
        to continue, nothing has been charged.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {phase === "contact" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData();
            form.set("name", name);
            form.set("phone", phone);
            form.set("email", email);
            startTransition(async () => {
              setError(null);
              const result = await requestSignupOtpAction(form);
              if (!result.ok) {
                setError(result.error ?? "Could not send the code");
                return;
              }
              setCode("");
              setExpiryAt(Date.now() + result.expiresIn * 1000);
              setResendAt(Date.now() + result.resendIn * 1000);
              setPhase("otp");
            });
          }}
        >
          <h2 className="font-semibold">Your details</h2>
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              For invoices and receipts, recommended.
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Sending code..." : "Verify my number"}
          </Button>
        </form>
      ) : null}

      {phase === "otp" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData();
            form.set("code", code);
            if (popia) form.set("popiaConsent", "on");
            if (waOptIn) form.set("marketingWhatsapp", "on");
            if (emailOptIn) form.set("marketingEmail", "on");
            run(
              () => verifySignupOtpAction(form),
              () => setPhase(requiresRica && !ricaDone ? "rica" : "review")
            );
          }}
        >
          <h2 className="font-semibold">Enter the 6-digit code</h2>
          <p className="text-sm text-muted-foreground">
            Sent to {phone || contact?.phone}. Codes last {ttlMinutes}{" "}
            {ttlMinutes === 1 ? "minute" : "minutes"}. This creates your Needd
            Connect account.
          </p>
          <Input
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="touch-target text-center font-mono text-lg tracking-[0.4em]"
            aria-label="6-digit code"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite" suppressHydrationWarning>
              {expiresIn > 0
                ? `Code expires in ${countdown(expiresIn)}`
                : "That code has expired, send a new one."}
            </span>
            <button
              type="button"
              suppressHydrationWarning
              disabled={pending || resendIn > 0}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  setNotice(null);
                  const result = await resendSignupOtpAction();
                  if (!result.ok) {
                    if (result.resendIn) {
                      setResendAt(Date.now() + result.resendIn * 1000);
                    }
                    setError(result.error ?? "Could not send a new code");
                    return;
                  }
                  setCode("");
                  setExpiryAt(Date.now() + result.expiresIn * 1000);
                  setResendAt(Date.now() + result.resendIn * 1000);
                  setNotice("New code sent.");
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium text-foreground disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              <span suppressHydrationWarning>
                {resendIn > 0
                  ? `Send a new code (${resendIn}s)`
                  : "Send a new code"}
              </span>
            </button>
          </div>
          <div className="space-y-2 rounded-2xl border bg-card p-4 text-sm">
            <label className="flex items-start gap-2">
              <Checkbox
                name="popiaConsent"
                className="mt-0.5"
                checked={popia}
                onCheckedChange={(v) => setPopia(v === true)}
              />
              <span>
                I consent to Needd Connect processing my information to provide
                and bill my services (required,{" "}
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
              <Checkbox
                name="marketingWhatsapp"
                className="mt-0.5"
                checked={waOptIn}
                onCheckedChange={(v) => setWaOptIn(v === true)}
              />
              <span className="text-muted-foreground">
                Send me deals on WhatsApp (optional).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox
                name="marketingEmail"
                className="mt-0.5"
                checked={emailOptIn}
                onCheckedChange={(v) => setEmailOptIn(v === true)}
              />
              <span className="text-muted-foreground">
                Send me deals by email (optional).
              </span>
            </label>
          </div>
          {notice ? (
            <p className="text-sm text-primary" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Checking..." : "Create my account"}
          </Button>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
                setPhase("contact");
              }}
              className="hover:underline"
            >
              Wrong number? Go back
            </button>
            {whatsapp ? (
              <a href={whatsapp} className="hover:underline">
                Code not arriving? WhatsApp us
              </a>
            ) : null}
          </div>
        </form>
      ) : null}

      {phase === "rica" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const formEl = e.currentTarget;
            const data = new FormData(formEl);
            const tooBig = (["idDoc", "poaDoc"] as const).find((key) => {
              const file = data.get(key);
              return file instanceof File && file.size > MAX_UPLOAD_BYTES;
            });
            if (tooBig) {
              setError(
                "One of those files is over 10MB. Take the photo again at a lower resolution, or crop it."
              );
              return;
            }
            run(() => submitRicaAction(data), () => setPhase("review"));
          }}
        >
          <div className="flex items-start gap-2 rounded-2xl border bg-card p-4">
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
            <Input
              id="idNumber"
              name="idNumber"
              required
              autoComplete="off"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idDoc">Photo of your ID document</Label>
            <Input
              id="idDoc"
              name="idDoc"
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              required={!ricaIdSaved}
            />
            {ricaIdSaved ? (
              <p className="flex items-center gap-1.5 text-xs text-primary">
                <Check className="size-3.5" aria-hidden />
                Saved. Only choose a file if you want to replace it.
              </p>
            ) : null}
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
              required={!ricaPoaSaved}
            />
            {ricaPoaSaved ? (
              <p className="flex items-center gap-1.5 text-xs text-primary">
                <Check className="size-3.5" aria-hidden />
                Saved. Only choose a file if you want to replace it.
              </p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Each file must be under 10MB.
          </p>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full touch-target" disabled={pending}>
            {pending ? "Uploading..." : "Save RICA details"}
          </Button>
        </form>
      ) : null}

      {phase === "review" || phase === "paying" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Review your order</h2>
            <Link
              href="/signup?step=1"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Pencil className="size-3" aria-hidden />
              Change plan
            </Link>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card">
            {summary.lines.map((line, i) => (
              <div key={i} className="border-b p-3 last:border-0">
                <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
                  <span>
                    {line.name}
                    {line.qty > 1 ? ` × ${line.qty}` : ""}
                  </span>
                  <span className="tnum shrink-0">
                    {money(line.totalCents)}
                  </span>
                </div>
                {line.components.length > 1 ? (
                  <ul className="mt-1.5 space-y-1">
                    {line.components.map((c, j) => (
                      <li
                        key={j}
                        className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
                      >
                        <span>{c.label}</span>
                        <span className="tnum shrink-0">
                          {money(multiply(c.amountCents, line.qty))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {line.stockNote ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {line.stockNote}
                  </p>
                ) : null}
              </div>
            ))}
            <div className="flex items-center justify-between border-t bg-muted/40 p-3 font-semibold">
              <span>Due now</span>
              <span className="tnum">{money(summary.totalDueNowCents)}</span>
            </div>
            {summary.monthlyCents > 0 ? (
              <p className="border-t p-3 text-xs text-muted-foreground">
                Your first month is included above. From activation you pay{" "}
                <span className="tnum font-medium text-foreground">
                  {money(summary.monthlyCents)}
                </span>{" "}
                a month, on the same date each month.
              </p>
            ) : null}
          </div>

          {address ? (
            <div className="rounded-2xl border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-2 text-sm">
                  <MapPin
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium">Delivery and service address</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {[
                        address.line1,
                        address.line2,
                        address.suburb,
                        address.city,
                        address.province,
                        address.postalCode,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                </div>
                <Link
                  href="/signup?step=2"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Pencil className="size-3" aria-hidden />
                  Edit
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">We still need your address</p>
              <p className="mt-1">
                We deliver hardware and check coverage against it before
                anything is charged.
              </p>
              <PillLink href="/signup?step=2" className="mt-3">
                Add my address
              </PillLink>
            </div>
          )}

          <div className="space-y-2 rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
            <p className="flex gap-2">
              <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                You pay on PayFast&apos;s secure page. We never see or store
                your card number.
              </span>
            </p>
            <p className="flex gap-2">
              <CreditCard
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden
              />
              <span>
                {summary.monthlyCents > 0 ? (
                  <>
                    Your card is stored securely with PayFast and charged{" "}
                    <span className="tnum">
                      {money(summary.monthlyCents)}
                    </span>{" "}
                    a month from activation. Cancel any time in your portal, no
                    penalty.
                  </>
                ) : (
                  <>
                    This is a once-off payment. Nothing recurring is set up for
                    this order.
                  </>
                )}
              </span>
            </p>
            <p className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                Your paid month starts when the service is activated, not today.
              </span>
            </p>
            <p className="pt-1 text-xs">
              By paying you accept our{" "}
              <a
                href="/legal/terms"
                target="_blank"
                className="text-primary hover:underline"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/legal/popia"
                target="_blank"
                className="text-primary hover:underline"
              >
                POPIA notice
              </a>
              .{" "}
              {whatsapp ? (
                <>
                  Questions before you pay?{" "}
                  <a href={whatsapp} className="text-primary hover:underline">
                    WhatsApp us
                  </a>
                  .
                </>
              ) : null}
            </p>
          </div>

          {error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
              {block === "address" ? (
                <PillLink href="/signup?step=2" className="mt-3">
                  Add my address
                </PillLink>
              ) : null}
              {block === "price_changed" ? (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setError(null);
                    setBlock(null);
                    router.refresh();
                  }}
                >
                  Show me the new total
                </Button>
              ) : null}
              {block === "already_paid" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <PillLink href="/portal">Open your portal</PillLink>
                  <form action={startNewOrderAction}>
                    <Button type="submit" variant="outline">
                      Start a new order
                    </Button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : null}

          <Button
            className="w-full touch-target"
            disabled={pending || phase === "paying" || !address}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                setBlock(null);
                const result = await startCheckoutAction(
                  summary.totalDueNowCents
                );
                if (!result.ok) {
                  setError(result.error);
                  setBlock(result.block);
                  if (result.block === "price_changed") router.refresh();
                  return;
                }
                setCheckout({
                  actionUrl: result.actionUrl,
                  fields: result.fields,
                });
                setPhase("paying");
              })
            }
          >
            {pending
              ? "Preparing secure payment..."
              : `Pay ${money(summary.totalDueNowCents)} securely`}
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
        Taking you to PayFast...{" "}
        <button type="submit" className="text-primary hover:underline">
          Continue manually
        </button>
      </p>
    </form>
  );
}
