"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A service identifier a customer gets asked for on the phone (their data
 * number, the SIM ICCID, a circuit reference). Rendered in the mono treatment
 * reserved for codes, with a copy control so nobody has to transcribe it.
 */
export function CopyCode({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-sm">{value}</span>
      <button
        type="button"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard blocked (insecure context, denied permission): the
            // value is on screen and selectable, so say nothing rather than
            // claim a copy that did not happen.
            setCopied(false);
          }
        }}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? `${label} copied to your clipboard` : ""}
      </span>
    </span>
  );
}
