"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  sendLoginCodeAction,
  verifyLoginCodeAction,
  type SendCodeResult,
  type VerifyCodeResult,
} from "./actions";

/**
 * Sign-in: email address, then the 6-digit code.
 *
 * Everything that can be said truthfully is said: which inbox the code went
 * to, how long it has left, how many tries remain, whether it expired or was
 * simply mistyped, and when a new one may be sent. Both fields are controlled,
 * so a rejected code never empties the form underneath the error message.
 */

function mmss(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Seconds remaining until an absolute deadline. The deadline is set from this
 * browser's clock when the server answers, never from a server timestamp: the
 * two are rarely in step, and the server enforces the real limits anyway.
 */
function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function OtpLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"send" | "verify" | "resend" | null>(null);

  const [step, setStep] = useState<"email" | "code">("email");
  const [emailInput, setEmailInput] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<{ email: string; via?: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expiryAt, setExpiryAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);

  const expiresIn = useCountdown(expiryAt);
  const resendIn = useCountdown(resendAt);

  const applySend = (result: SendCodeResult) => {
    if (!result.ok || !result.email) {
      setError(result.error ?? "We could not send the code just now.");
      if (result.resendInSeconds != null) {
        setResendAt(Date.now() + result.resendInSeconds * 1000);
      }
      return;
    }
    const now = Date.now();
    setSentTo({ email: result.email, via: result.via });
    setExpiryAt(now + (result.expiresInSeconds ?? 300) * 1000);
    setResendAt(now + (result.resendInSeconds ?? 60) * 1000);
    setNotice(result.notice ?? null);
    setCode("");
    setStep("code");
  };

  const send = (resend: boolean) => {
    const email = resend ? (sentTo?.email ?? emailInput) : emailInput;
    setBusy(resend ? "resend" : "send");
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        applySend(await sendLoginCodeAction({ email, resend }));
      } catch {
        setError(
          "We could not reach Needd Connect just now. Check your connection and try again."
        );
      }
      setBusy(null);
    });
  };

  const verify = () => {
    if (!sentTo) return;
    setBusy("verify");
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        // A successful sign-in redirects from the server, so the call resolves
        // with nothing while the browser is already on its way: anything that
        // does come back is a refusal, with a reason to show.
        const result: VerifyCodeResult | undefined = await verifyLoginCodeAction(
          { email: sentTo.email, code, callbackUrl }
        );
        if (result && !result.ok) setError(result.error);
      } catch {
        setError(
          "We could not reach Needd Connect just now. Check your connection and try again."
        );
      }
      setBusy(null);
    });
  };

  const changeEmail = () => {
    setStep("email");
    setError(null);
    setNotice(null);
    setCode("");
  };

  const onCodeStep = step === "code" && sentTo !== null;

  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (onCodeStep) verify();
        else send(false);
      }}
    >
      {onCodeStep ? (
        <div key="code-step" className="space-y-2">
          <Label htmlFor="code">Enter the 6-digit code</Label>
          <Input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-describedby="code-hint otp-status"
            aria-invalid={error ? true : undefined}
            className="touch-target text-center font-mono text-lg tracking-[0.4em]"
          />
          <p id="code-hint" className="text-sm text-muted-foreground">
            {/* Only name the inbox when we know the code actually went there. */}
            Sent {sentTo.via === "email" ? "by email " : ""}to{" "}
            <span className="font-medium text-foreground break-all">
              {sentTo.email}
            </span>
            .
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <span>
              {expiresIn > 0
                ? `Code expires in ${mmss(expiresIn)}`
                : "That code has expired, send a new one."}
            </span>
            <button
              type="button"
              onClick={() => send(true)}
              disabled={pending || resendIn > 0}
              className="inline-flex touch-target items-center gap-1.5 rounded-full border px-3 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {busy === "resend"
                ? "Sending..."
                : resendIn > 0
                  ? `Send a new code (${resendIn}s)`
                  : "Send a new code"}
            </button>
          </div>
        </div>
      ) : (
        <div key="email-step" className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="thandi@example.com"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            aria-describedby="email-hint otp-status"
            aria-invalid={error ? true : undefined}
            className="touch-target"
          />
          <p id="email-hint" className="text-sm text-muted-foreground">
            The email address on your Needd Connect account. We send a 6-digit
            code, so there is no password to remember.
          </p>
        </div>
      )}

      {/*
        One live region for both steps, in the markup from the first render so
        a screen reader announces whatever lands in it. Polite, because the
        customer is mid-type and none of this is worth interrupting them for.
      */}
      <div id="otp-status" aria-live="polite">
        {error ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : notice ? (
          <p className="rounded-2xl border border-primary/25 bg-accent px-4 py-3 text-sm text-accent-foreground">
            {notice}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full touch-target" disabled={pending}>
        {busy === "verify"
          ? "Checking..."
          : busy === "send"
            ? "Sending..."
            : onCodeStep
              ? "Sign in"
              : "Send my code"}
      </Button>

      {onCodeStep ? (
        <div className="space-y-2 text-center text-xs text-muted-foreground">
          <p>
            Code not arriving? Check your spam or junk folder, then send a new
            one.
          </p>
          <button
            type="button"
            onClick={changeEmail}
            disabled={pending}
            className="inline-flex items-center gap-1 hover:text-foreground hover:underline disabled:opacity-50"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Change email address
          </button>
        </div>
      ) : null}
    </form>
  );
}
