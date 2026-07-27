"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/app/portal/_lib/run-action";
import {
  withdrawCancellationAction,
  cancelScheduledPlanChangeAction,
  type ServiceActionResult,
} from "./actions";

function useServiceAction(serviceId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (call: () => Promise<ServiceActionResult>) =>
    startTransition(async () => {
      setError(null);
      const result = await runAction(call);
      if (result.ok) {
        router.push(result.href);
        router.refresh();
      } else {
        setError(result.error);
      }
    });

  return { pending, error, run, serviceId };
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message} Nothing was changed.</span>
    </p>
  );
}

/** Withdraw a scheduled cancellation, keeping the service as it is. */
export function WithdrawCancellationButton({
  serviceId,
}: {
  serviceId: string;
}) {
  const { pending, error, run } = useServiceAction(serviceId);
  return (
    <div className="space-y-2">
      {error ? <ErrorNote message={error} /> : null}
      <Button
        type="button"
        className="w-full touch-target"
        disabled={pending}
        onClick={() => run(() => withdrawCancellationAction({ serviceId }))}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Keeping your service…
          </>
        ) : (
          "Withdraw cancellation, keep my service"
        )}
      </Button>
    </div>
  );
}

/** Undo a scheduled plan change before it takes effect. */
export function CancelScheduledChangeButton({
  serviceId,
}: {
  serviceId: string;
}) {
  const { pending, error, run } = useServiceAction(serviceId);
  return (
    <div className="mt-3 space-y-2">
      {error ? <ErrorNote message={error} /> : null}
      <Button
        type="button"
        variant="outline"
        className="w-full touch-target"
        disabled={pending}
        onClick={() =>
          run(() => cancelScheduledPlanChangeAction({ serviceId }))
        }
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Cancelling the change…
          </>
        ) : (
          "Cancel this change, stay on my plan"
        )}
      </Button>
    </div>
  );
}
