"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { resolveUnallocatedPaymentAction, type Result } from "./actions";

/**
 * Clear one unallocated payment off the queue.
 *
 * Two submit buttons rather than a dropdown, because the operator has already
 * decided by the time they get here and the wording is the whole question:
 * the money either went onto another invoice or went back to the customer.
 * Nothing here moves money, it records what was done, so the note is required.
 */
export function ResolveUnallocatedForm({
  gatewayRef,
  invoiceId,
}: {
  gatewayRef: string;
  invoiceId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (form: FormData) =>
    startTransition(async () => {
      const result: Result = await resolveUnallocatedPaymentAction(form);
      if (result.ok) {
        toast.success("Cleared from the queue");
        router.refresh();
      } else toast.error(result.error ?? "Failed");
    });

  const noteId = `allocation-note-${gatewayRef}`;
  return (
    <form
      action={run}
      className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
    >
      <input type="hidden" name="gatewayRef" value={gatewayRef} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="min-w-[16rem] flex-1 space-y-1">
        <Label htmlFor={noteId} className="text-xs">
          Where the money went
        </Label>
        <Input
          id={noteId}
          name="note"
          required
          minLength={4}
          maxLength={500}
          placeholder="Applied to INV-2026-0142, or refunded on PayFast 21 July"
        />
      </div>
      <button
        type="submit"
        name="outcome"
        value="allocated"
        disabled={pending}
        className={cn(buttonVariants({ variant: "default", size: "sm" }))}
      >
        {pending ? "Saving…" : "Allocated"}
      </button>
      <button
        type="submit"
        name="outcome"
        value="refunded"
        disabled={pending}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        {pending ? "Saving…" : "Refunded"}
      </button>
    </form>
  );
}
