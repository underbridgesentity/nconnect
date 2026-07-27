"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/app/portal/_lib/run-action";
import { changePlanAction } from "../actions";

/**
 * Confirm a plan change. This fires a connector round trip and, on an
 * upgrade, a live card charge, so it must never be double-submittable and
 * must never leave the customer guessing: the button disables and states what
 * it is doing, and any failure is shown here rather than replacing the page
 * with an error boundary.
 */
export function ConfirmPlanChange({
  serviceId,
  newPlanId,
  label,
  pendingLabel,
}: {
  serviceId: string;
  newPlanId: string;
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {error} Nothing was changed and nothing was charged.
          </span>
        </p>
      ) : null}
      <Button
        type="button"
        className="w-full touch-target"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await runAction(() =>
              changePlanAction({ serviceId, newPlanId })
            );
            if (result.ok) {
              router.push(result.href);
              router.refresh();
            } else {
              setError(result.error);
            }
          })
        }
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {pendingLabel}
          </>
        ) : (
          label
        )}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        One tap is enough. If it takes a moment, that is us talking to the
        network, please do not tap again.
      </p>
    </div>
  );
}
