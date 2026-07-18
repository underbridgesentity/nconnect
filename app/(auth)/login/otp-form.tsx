"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestOtpAction,
  verifyOtpAction,
  type OtpFormState,
} from "./actions";

const initialState: OtpFormState = { step: "phone" };

export function OtpLoginForm() {
  const [state, formAction, pending] = useActionState(
    async (prev: OtpFormState, formData: FormData) => {
      if (prev.step === "phone") return requestOtpAction(prev, formData);
      return verifyOtpAction(prev, formData);
    },
    initialState
  );

  if (state.step === "phone") {
    return (
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Cellphone number</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="082 123 4567"
            required
            className="touch-target"
          />
        </div>
        {state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}
        <Button type="submit" className="w-full touch-target" disabled={pending}>
          {pending ? "Sending…" : "Send code"}
        </Button>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="phone" value={state.phone} />
      <div className="space-y-2">
        <Label htmlFor="code">Enter the 6-digit code</Label>
        <Input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="touch-target text-center font-mono text-lg tracking-[0.4em]"
        />
        <p className="text-sm text-muted-foreground">
          Sent to {state.phone}. It expires in 5 minutes.
        </p>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <Button type="submit" className="w-full touch-target" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </Button>
    </form>
  );
}
