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
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      ref={formRef}
      className="space-y-2 rounded-2xl border bg-card p-3"
      action={(form) =>
        startTransition(async () => {
          setError(null);
          const r = await quickAddLeadAction(form);
          if (r.ok) {
            toast.success("Lead captured");
            formRef.current?.reset();
            router.refresh();
          } else {
            setError(r.error ?? "Failed");
            toast.error(r.error ?? "Failed");
          }
        })
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="name"
          placeholder="Name"
          required
          aria-label="Lead name"
          className="w-36 flex-1"
        />
        <Input
          name="phone"
          type="tel"
          placeholder="082 123 4567"
          required
          aria-label="Cellphone number"
          className="w-36 flex-1"
        />
        <Input
          name="email"
          type="email"
          placeholder="Email (optional)"
          aria-label="Email address"
          className="w-40 flex-1"
        />
        <Input
          name="interest"
          placeholder="Interested in… (optional)"
          aria-label="What they are interested in"
          className="hidden flex-1 sm:block"
        />
        <Button
          type="submit"
          className="touch-target px-5"
          disabled={pending}
          aria-describedby={error ? "quick-add-error" : undefined}
        >
          <Plus className="size-4" /> {pending ? "Saving…" : "Add lead"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        An email means a quote can still reach them when WhatsApp cannot.
      </p>
      {error ? (
        <p id="quick-add-error" role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ClaimButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      className="touch-target px-5"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await claimLeadAction(leadId);
          if (r.ok) {
            toast.success("Lead claimed, it's yours");
            router.refresh();
          } else {
            toast.error(r.error ?? "Failed");
            // Someone else won the race: the list is now out of date.
            router.refresh();
          }
        })
      }
    >
      {pending ? "Claiming…" : "Claim"}
    </Button>
  );
}

export function ActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"note" | "call" | "whatsapp">("note");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      ref={formRef}
      className="space-y-2"
      action={(form) =>
        startTransition(async () => {
          setError(null);
          const r = await logActivityAction(form);
          if (r.ok) {
            formRef.current?.reset();
            router.refresh();
          } else {
            setError(r.error ?? "Failed");
            toast.error(r.error ?? "Failed");
          }
        })
      }
    >
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-1.5" role="group" aria-label="Activity type">
        {(["note", "call", "whatsapp"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`touch-target rounded-full px-4 text-xs capitalize ${
              kind === k
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "activity-error" : undefined}
        placeholder={
          kind === "note"
            ? "What happened?"
            : kind === "call"
              ? "Call summary"
              : "WhatsApp summary"
        }
      />
      {error ? (
        <p id="activity-error" role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="touch-target px-5" disabled={pending}>
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
      <div className="flex flex-wrap gap-2">
        {status === "new" ? (
          <Button
            variant="outline"
            className="touch-target px-5"
            disabled={pending}
            onClick={() => set("contacted")}
          >
            Mark contacted
          </Button>
        ) : null}
        {status !== "lost" && status !== "won" ? (
          <Button
            variant="outline"
            className="touch-target px-5"
            disabled={pending}
            aria-expanded={losing}
            onClick={() => setLosing((v) => !v)}
          >
            Mark lost…
          </Button>
        ) : null}
        {status === "lost" ? (
          <Button
            variant="outline"
            className="touch-target px-5"
            disabled={pending}
            onClick={() => set("contacted")}
          >
            Reopen
          </Button>
        ) : null}
      </div>
      {losing ? (
        <form
          className="flex flex-wrap gap-2"
          action={(form) => {
            const reason = String(form.get("reason") ?? "");
            set("lost", reason);
          }}
        >
          <Input
            name="reason"
            placeholder="Why did we lose it?"
            aria-label="Reason we lost the lead"
            required
            className="min-w-40 flex-1"
          />
          <Button
            type="submit"
            variant="destructive"
            className="touch-target px-5"
            disabled={pending}
          >
            Confirm lost
          </Button>
        </form>
      ) : null}
    </div>
  );
}
