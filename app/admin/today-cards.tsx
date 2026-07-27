"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/shared/status-pill";
import { formatDate } from "@/lib/format";
import { Check, ChevronDown, Copy, Eye, EyeOff, FileText } from "lucide-react";
import {
  toggleChecklistAction,
  completeTaskAction,
  closeFeasibilityAction,
  verifyRicaAction,
  rejectRicaAction,
  ricaDocUrlsAction,
} from "./today-actions";

export type TaskCardData = {
  id: string;
  type: string;
  status: string;
  dueAt: string | null;
  checklist: { label: string; done: boolean }[];
  serviceName: string | null;
  customerName: string;
  category: string | null;
  isSim: boolean;
  ricaVerified: boolean;
};

export function TaskCard({ task }: { task: TaskCardData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const allDone = task.checklist.every((c) => c.done);
  const overdue = task.dueAt ? new Date(task.dueAt) < new Date() : false;

  return (
    <div className="rounded-lg border bg-card p-4">
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div>
          <span className="font-medium">
            {task.type === "activate"
              ? "Activate"
              : task.type === "suspend"
                ? "Suspend"
                : task.type === "reactivate"
                  ? "Reactivate"
                  : task.type === "cancel"
                    ? "Cancel"
                    : "Change plan"}
            : {task.serviceName}
          </span>
          <span className="block text-sm text-muted-foreground">
            {task.customerName}
            {overdue ? (
              <span className="ml-2 font-medium text-red-600">overdue</span>
            ) : null}
          </span>
        </div>
        <span className="flex items-center gap-2">
          <StatusPill status={task.status} />
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          {task.type === "activate" && task.isSim && !task.ricaVerified ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
              RICA not verified yet, verify it in the RICA section below
              before completing this activation.
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {task.checklist.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={item.done}
                  disabled={pending}
                  onCheckedChange={(v) =>
                    startTransition(async () => {
                      const r = await toggleChecklistAction(task.id, i, v === true);
                      if (!r.ok) toast.error(r.error);
                      else router.refresh();
                    })
                  }
                  aria-label={item.label}
                />
                <span className={item.done ? "text-muted-foreground line-through" : ""}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
          <form
            className="space-y-2"
            action={(form) =>
              startTransition(async () => {
                const r = await completeTaskAction(form);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Task completed");
                  router.refresh();
                }
              })
            }
          >
            <input type="hidden" name="taskId" value={task.id} />
            {task.type === "activate" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input name="externalRef" placeholder="Provider external ref" />
                {task.isSim ? (
                  <>
                    <Input name="simIccid" placeholder="SIM ICCID" />
                    <Input name="msisdn" placeholder="MSISDN (e.g. 27821234567)" />
                  </>
                ) : task.category === "fibre" ? (
                  <Input name="circuitId" placeholder="Circuit ID" />
                ) : null}
              </div>
            ) : null}
            <Textarea name="resultNotes" placeholder="Notes (optional)" rows={2} />
            <Button
              type="submit"
              size="sm"
              disabled={pending || !allDone}
              title={allDone ? undefined : "Tick every checklist item first"}
            >
              {pending ? "Working…" : "Complete task"}
            </Button>
            {!allDone ? (
              <p className="text-xs text-muted-foreground">
                Tick every checklist item to enable completion.
              </p>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}

export type FeasibilityCardData = {
  taskId: string;
  leadName: string;
  leadPhone: string;
  addressText: string | null;
  interest: string | null;
  dueAt: string | null;
};

export function FeasibilityCard({ item }: { item: FeasibilityCardData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const overdue = item.dueAt ? new Date(item.dueAt) < new Date() : false;
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="font-medium">
        {item.leadName}{" "}
        <a
          href={`https://wa.me/${item.leadPhone.replace(/\D/g, "")}`}
          className="text-sm font-normal text-primary hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {item.leadPhone}
        </a>
        {overdue ? (
          <span className="ml-2 text-sm font-medium text-red-600">overdue</span>
        ) : null}
      </p>
      <p className="text-sm text-muted-foreground">{item.addressText}</p>
      {item.interest ? (
        <p className="text-xs text-muted-foreground">{item.interest}</p>
      ) : null}
      <form
        className="mt-2 flex gap-2"
        action={(form) =>
          startTransition(async () => {
            const r = await closeFeasibilityAction(form);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Feasibility closed");
              router.refresh();
            }
          })
        }
      >
        <input type="hidden" name="taskId" value={item.taskId} />
        <Input
          name="resultNotes"
          placeholder="Outcome (e.g. Vumatel live, sent options)"
          required
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={pending}>
          Close
        </Button>
      </form>
    </div>
  );
}

export type RicaCardData = {
  id: string;
  customerName: string;
  maskedId: string;
  createdAt: string;
};

type RicaDocs = {
  idDocUrl: string | null;
  poaDocUrl: string | null;
  idNumber: string;
};

/** Selectable ID number with a reveal toggle and a copy button. */
function IdNumberField({ idNumber }: { idNumber: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">ID number</span>
      <code className="select-all rounded-md bg-muted px-2 py-1 font-mono text-sm tracking-wide">
        {revealed ? idNumber : "•".repeat(idNumber.length || 13)}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setRevealed((v) => !v)}
        aria-pressed={revealed}
      >
        {revealed ? (
          <>
            <EyeOff className="size-3.5" aria-hidden /> Hide
          </>
        ) : (
          <>
            <Eye className="size-3.5" aria-hidden /> Reveal
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(idNumber);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            toast.error("Could not copy, reveal it and select the number");
          }
        }}
      >
        {copied ? (
          <>
            <Check className="size-3.5" aria-hidden /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3.5" aria-hidden /> Copy
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * RICA verification (§13). The documents, the ID number and both decisions
 * live in one dialog: the old flow awaited a server action and then called
 * window.open twice, which browsers block because the await consumes the
 * user gesture, and it put an unmasked 13-digit ID number in a toast that
 * vanished after 15 seconds.
 */
export function RicaCard({ record }: { record: RicaCardData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<RicaDocs | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const openDialog = () => {
    setOpen(true);
    setRejecting(false);
    if (docs) return;
    startTransition(async () => {
      const r = await ricaDocUrlsAction(record.id);
      if (!r.ok) {
        toast.error(r.error);
        setOpen(false);
        return;
      }
      setDocs({
        idDocUrl: r.idDocUrl,
        poaDocUrl: r.poaDocUrl,
        idNumber: r.idNumber,
      });
    });
  };

  const documents: [string, string | null][] = [
    ["Identity document", docs?.idDocUrl ?? null],
    ["Proof of address", docs?.poaDocUrl ?? null],
  ];

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{record.customerName}</p>
          <p className="font-mono text-sm text-muted-foreground">
            {record.maskedId}
          </p>
          <p className="text-xs text-muted-foreground">
            Submitted {formatDate(record.createdAt)}
          </p>
        </div>
        <Button size="sm" onClick={openDialog} disabled={pending}>
          <FileText className="size-3.5" aria-hidden /> Check documents
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Verify RICA: {record.customerName}</DialogTitle>
            <DialogDescription>
              Compare the ID number against the document. Every document view
              is logged and records are kept for five years after termination.
            </DialogDescription>
          </DialogHeader>

          {!docs ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading documents…
            </p>
          ) : (
            <div className="space-y-4">
              <IdNumberField idNumber={docs.idNumber} />

              <div className="grid gap-3 sm:grid-cols-2">
                {documents.map(([label, url]) => (
                  <div key={label} className="space-y-1.5">
                    <p className="text-xs font-medium">{label}</p>
                    {url ? (
                      <>
                        <iframe
                          src={url}
                          title={`${label} for ${record.customerName}`}
                          className="h-72 w-full rounded-lg border bg-muted"
                        />
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Open full size
                        </a>
                      </>
                    ) : (
                      <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                        Not uploaded. Reject and ask the customer to submit it.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {rejecting ? (
                <form
                  className="space-y-2 rounded-lg border border-dashed p-3"
                  action={(form) =>
                    startTransition(async () => {
                      const r = await rejectRicaAction(form);
                      if (!r.ok) toast.error(r.error);
                      else {
                        toast.success("RICA rejected, customer must resubmit");
                        setOpen(false);
                        router.refresh();
                      }
                    })
                  }
                >
                  <input type="hidden" name="ricaId" value={record.id} />
                  <Label htmlFor={`rica-reason-${record.id}`}>
                    Why is this being rejected? (sent to the customer)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id={`rica-reason-${record.id}`}
                      name="reason"
                      placeholder="e.g. the ID photo is unreadable"
                      required
                      autoFocus
                      className="min-w-52 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRejecting(false)}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                    >
                      Confirm reject
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => setRejecting(true)}
                  >
                    Reject…
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await verifyRicaAction(record.id);
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success("RICA verified");
                          setOpen(false);
                          router.refresh();
                        }
                      })
                    }
                  >
                    {pending ? "Working…" : "Verify"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
