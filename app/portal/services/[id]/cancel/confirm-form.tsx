"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/app/portal/_lib/run-action";
import { cancelServiceAction } from "../actions";

/** Confirm a cancellation: single submit, pending state, errors shown inline. */
export function ConfirmCancellation({
  serviceId,
  effectiveDateLabel,
}: {
  serviceId: string;
  effectiveDateLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="cancel-reason" className="text-muted-foreground">
          Mind telling us why? Optional, it helps us fix things.
        </Label>
        <Textarea
          id="cancel-reason"
          name="reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={pending}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error} Your service has not been cancelled.</span>
        </p>
      ) : null}

      <Button
        type="button"
        variant="destructive"
        className="w-full touch-target"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await runAction(() =>
              cancelServiceAction({ serviceId, reason })
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
            Cancelling…
          </>
        ) : (
          `Cancel my service on ${effectiveDateLabel}`
        )}
      </Button>

      <Button
        variant="ghost"
        className="w-full touch-target"
        render={<Link href={`/portal/services/${serviceId}`} />}
      >
        Never mind, keep my service
      </Button>
    </div>
  );
}
