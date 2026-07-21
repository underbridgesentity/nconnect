"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/shared/status-pill";
import { ChevronDown, ExternalLink } from "lucide-react";
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

export function RicaCard({ record }: { record: RicaCardData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);

  const viewDocs = () =>
    startTransition(async () => {
      const r = await ricaDocUrlsAction(record.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.idDocUrl) window.open(r.idDocUrl, "_blank", "noopener");
      if (r.poaDocUrl) window.open(r.poaDocUrl, "_blank", "noopener");
      toast.info(`ID number: ${r.idNumber}`, { duration: 15000 });
    });

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{record.customerName}</p>
          <p className="font-mono text-sm text-muted-foreground">
            {record.maskedId}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={viewDocs} disabled={pending}>
            <ExternalLink className="size-3.5" /> View docs
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await verifyRicaAction(record.id);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("RICA verified");
                  router.refresh();
                }
              })
            }
          >
            Verify
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => setRejecting((v) => !v)}
          >
            Reject
          </Button>
        </div>
      </div>
      {rejecting ? (
        <form
          className="mt-2 flex gap-2"
          action={(form) =>
            startTransition(async () => {
              const r = await rejectRicaAction(form);
              if (!r.ok) toast.error(r.error);
              else {
                toast.success("RICA rejected, customer must resubmit");
                router.refresh();
              }
            })
          }
        >
          <input type="hidden" name="ricaId" value={record.id} />
          <Input
            name="reason"
            placeholder="Reason (sent to the customer)"
            required
            className="flex-1"
          />
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            Confirm reject
          </Button>
        </form>
      ) : null}
    </div>
  );
}
