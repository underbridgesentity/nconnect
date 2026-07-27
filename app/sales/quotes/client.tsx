"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendQuoteAction } from "./actions";

/**
 * Send tells the truth. A quote that reached nobody produces a warning with
 * the share link attached, never a green "Quote sent".
 */
export function SendQuoteButton({
  quoteId,
  label = "Send",
  variant = "default",
}: {
  quoteId: string;
  label?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      className="touch-target px-5"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await sendQuoteAction(quoteId);
          if (!r.ok) {
            toast.error(r.error ?? "Failed", { duration: 8000 });
            return;
          }
          if (r.delivered) {
            toast.success(r.message ?? "Quote sent");
          } else {
            toast.warning(r.message ?? "Nothing was delivered", {
              duration: 15000,
              description: r.link,
              action: r.link
                ? {
                    label: "Copy link",
                    onClick: () => void copyToClipboard(r.link!),
                  }
                : undefined,
            });
          }
          router.refresh();
        })
      }
    >
      <Send className="size-4" aria-hidden />
      {pending ? "Sending…" : label}
    </Button>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The rep's manual delivery route: always available, on every quote. */
export function CopyLinkButton({
  link,
  label = "Copy link",
  className,
}: {
  link: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      className={`touch-target px-5 ${className ?? ""}`}
      onClick={async () => {
        const ok = await copyToClipboard(link);
        if (!ok) {
          toast.error("Your browser blocked the clipboard, select the link and copy it", {
            duration: 8000,
          });
          return;
        }
        setCopied(true);
        toast.success("Share link copied");
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      {copied ? "Copied" : label}
    </Button>
  );
}
