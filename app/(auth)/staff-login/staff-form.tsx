"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { staffLoginAction, type StaffLoginState } from "./actions";

export function StaffLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, formAction, pending] = useActionState<StaffLoginState, FormData>(
    staffLoginAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      {callbackUrl ? (
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby="staff-login-status"
          aria-invalid={state.error ? true : undefined}
          className="touch-target"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby="staff-login-status"
          aria-invalid={state.error ? true : undefined}
          className="touch-target"
        />
      </div>
      <div id="staff-login-status" aria-live="polite">
        {state.error ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
      <Button type="submit" className="w-full touch-target" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
