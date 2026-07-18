"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendQuoteAction } from "./actions";

export function SendQuoteButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await sendQuoteAction(quoteId);
          if (r.ok) {
            toast.success("Quote sent");
            router.refresh();
          } else toast.error(r.error ?? "Failed");
        })
      }
    >
      {pending ? "Sending…" : "Send"}
    </Button>
  );
}
