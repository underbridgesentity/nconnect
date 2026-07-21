"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  quickAddLeadAction,
  logActivityAction,
  setLeadStatusAction,
  claimLeadAction,
} from "./actions";

export function QuickAddLead() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"
      action={(form) =>
        startTransition(async () => {
          const r = await quickAddLeadAction(form);
          if (r.ok) {
            toast.success("Lead captured");
            formRef.current?.reset();
            router.refresh();
          } else toast.error(r.error ?? "Failed");
        })
      }
    >
      <Input name="name" placeholder="Name" required className="w-36 flex-1" />
      <Input
        name="phone"
        type="tel"
        placeholder="082 123 4567"
        required
        className="w-36 flex-1"
      />
      <Input
        name="interest"
        placeholder="Interested in… (optional)"
        className="hidden flex-1 sm:block"
      />
      <Button type="submit" size="sm" disabled={pending}>
        <Plus className="size-4" /> {pending ? "Saving…" : "Add lead"}
      </Button>
    </form>
  );
}

export function ClaimButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await claimLeadAction(leadId);
          if (r.ok) {
            toast.success("Lead claimed, it's yours");
            router.refresh();
          } else toast.error(r.error ?? "Failed");
        })
      }
    >
      Claim
    </Button>
  );
}

export function ActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"note" | "call" | "whatsapp">("note");
  return (
    <form
      ref={formRef}
      className="space-y-2"
      action={(form) =>
        startTransition(async () => {
          const r = await logActivityAction(form);
          if (r.ok) {
            formRef.current?.reset();
            router.refresh();
          } else toast.error(r.error ?? "Failed");
        })
      }
    >
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-1">
        {(["note", "call", "whatsapp"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-xs capitalize ${
              kind === k
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      <Textarea
        name="body"
        rows={2}
        required
        placeholder={
          kind === "note"
            ? "What happened?"
            : kind === "call"
              ? "Call summary"
              : "WhatsApp summary"
        }
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Logging…" : "Log activity"}
      </Button>
    </form>
  );
}

export function LeadStatusButtons({
  leadId,
  status,
}: {
  leadId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [losing, setLosing] = useState(false);
  const set = (s: "new" | "contacted" | "quoted" | "won" | "lost", reason?: string) =>
    startTransition(async () => {
      const r = await setLeadStatusAction(leadId, s, reason);
      if (r.ok) {
        toast.success("Status updated");
        router.refresh();
        setLosing(false);
      } else toast.error(r.error ?? "Failed");
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {status === "new" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => set("contacted")}>
            Mark contacted
          </Button>
        ) : null}
        {status !== "lost" && status !== "won" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setLosing((v) => !v)}
          >
            Mark lost…
          </Button>
        ) : null}
        {status === "lost" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => set("contacted")}>
            Reopen
          </Button>
        ) : null}
      </div>
      {losing ? (
        <form
          className="flex gap-2"
          action={(form) => {
            const reason = String(form.get("reason") ?? "");
            set("lost", reason);
          }}
        >
          <Input name="reason" placeholder="Why did we lose it?" required className="flex-1" />
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            Confirm lost
          </Button>
        </form>
      ) : null}
    </div>
  );
}
