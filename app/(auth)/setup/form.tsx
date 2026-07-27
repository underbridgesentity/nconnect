"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setupAction, type SetupState } from "./actions";

export function SetupForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(
    setupAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          aria-describedby="setup-status"
          className="touch-target"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password (min 10 characters)</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          aria-describedby="setup-status"
          className="touch-target"
        />
      </div>
      <div id="setup-status" aria-live="polite">
        {state.error ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
      <Button type="submit" className="w-full touch-target" disabled={pending}>
        {pending ? "Setting up..." : "Activate my account"}
      </Button>
    </form>
  );
}
