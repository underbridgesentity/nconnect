"use client";

import { useState, useTransition } from "react";
import { PillButton } from "@/components/public/pill";
import { resumeQuotePaymentAction } from "./actions";

/**
 * Resume payment on an order the customer never finished paying for.
 * Renders as a normal button until pressed, then posts the PayFast form.
 */
export function ResumePaymentButton({
  token,
  label,
}: {
  token: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{
    actionUrl: string;
    fields: Record<string, string>;
  } | null>(null);

  if (checkout) {
    return (
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
    );
  }

  return (
    <div className="space-y-2">
      <PillButton
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await resumeQuotePaymentAction(token);
            if (r.ok) setCheckout({ actionUrl: r.actionUrl, fields: r.fields });
            else setError(r.error);
          })
        }
        className="flex w-full px-7"
      >
        {pending ? "Opening secure payment…" : label}
      </PillButton>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
