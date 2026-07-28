"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoreHorizontal, Pencil } from "lucide-react";
import { formatCents } from "@/lib/money";
import {
  updateCustomerAction,
  assignRepAction,
  saveNotesAction,
  recordEftAction,
  markOrderPaidManuallyAction,
  suspendServiceAction,
  reactivateServiceAction,
  overrideCancelAction,
  voidInvoiceAction,
  writeOffInvoiceAction,
  creditInvoiceAction,
  type Result,
} from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, success: string, done?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        router.refresh();
        done?.();
      } else toast.error(r.error ?? "Failed");
    });
  return { pending, run };
}

type CustomerShape = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
};

export function EditDetailsSheet({ customer }: { customer: CustomerShape }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <Pencil className="size-3.5" /> Edit
          </Button>
        }
      />
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit customer</SheetTitle>
        </SheetHeader>
        <form
          className="space-y-4 px-4 pb-8"
          action={(form) =>
            run(() => updateCustomerAction(form), "Saved", () => setOpen(false))
          }
        >
          <input type="hidden" name="customerId" value={customer.id} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                name="firstName"
                defaultValue={customer.firstName ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                name="lastName"
                defaultValue={customer.lastName ?? ""}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company (optional)</Label>
            <Input
              id="companyName"
              name="companyName"
              defaultValue={customer.companyName ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={customer.email ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={customer.phone ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vatNumber">VAT number (optional)</Label>
            <Input
              id="vatNumber"
              name="vatNumber"
              defaultValue={customer.vatNumber ?? ""}
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function AssignRepSelect({
  customerId,
  current,
  reps,
}: {
  customerId: string;
  current: string | null;
  reps: { id: string; name: string }[];
}) {
  const { pending, run } = useRun();
  return (
    <Select
      value={current ?? "none"}
      onValueChange={(v) =>
        run(
          () => assignRepAction(customerId, v === "none" ? null : v),
          "Rep updated"
        )
      }
      disabled={pending}
    >
      <SelectTrigger className="w-44" aria-label="Assigned sales rep">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned</SelectItem>
        {reps.map((rep) => (
          <SelectItem key={rep.id} value={rep.id}>
            {rep.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NotesForm({
  customerId,
  notes,
}: {
  customerId: string;
  notes: string;
}) {
  const { pending, run } = useRun();
  return (
    <form
      className="space-y-3"
      action={(form) => run(() => saveNotesAction(form), "Notes saved")}
    >
      <input type="hidden" name="customerId" value={customerId} />
      <Textarea
        name="notes"
        rows={8}
        defaultValue={notes}
        placeholder="Anything the team should know about this customer."
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save notes"}
      </Button>
    </form>
  );
}

/**
 * Manual EFT capture. The amount is text, not a number input: a number
 * input silently submits "" for a bank-formatted paste like "R1 200,00",
 * which used to book a permanent R0.00 payment. `parseZar` on the server
 * reads both forms and rejects anything else. The value date is required
 * because an EFT usually cleared before the operator gets to type it in.
 */
export function RecordEftForm({
  invoiceId,
  customerId,
  outstandingCents,
  today,
}: {
  invoiceId: string;
  customerId: string;
  outstandingCents: number;
  today: string;
}) {
  const { pending, run } = useRun();
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
      action={(form) => run(() => recordEftAction(form), "EFT recorded")}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="customerId" value={customerId} />
      <div className="space-y-1">
        <Label htmlFor={`amount-${invoiceId}`} className="text-xs">
          Amount received
        </Label>
        <Input
          id={`amount-${invoiceId}`}
          name="amount"
          inputMode="decimal"
          // `formatCents`, not cents/100: money never goes through a float,
          // not even to prefill a field. `parseZar` reads this app's own
          // en-ZA rendering back, spaces, comma and all.
          defaultValue={formatCents(outstandingCents)}
          required
          className="tnum w-32"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`paidOn-${invoiceId}`} className="text-xs">
          Date received
        </Label>
        <Input
          id={`paidOn-${invoiceId}`}
          name="paidOn"
          type="date"
          defaultValue={today}
          max={today}
          required
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`reference-${invoiceId}`} className="text-xs">
          Bank reference
        </Label>
        <Input
          id={`reference-${invoiceId}`}
          name="reference"
          placeholder="Statement reference"
          required
          className="w-44"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Recording…" : "Record EFT"}
      </Button>
    </form>
  );
}

export function MarkOrderPaidForm({
  orderId,
  customerId,
  amountCents,
}: {
  orderId: string;
  customerId: string;
  amountCents: number;
}) {
  const { pending, run } = useRun();
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
      action={(form) =>
        run(() => markOrderPaidManuallyAction(form), "Order marked paid")
      }
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="amountCents" value={amountCents} />
      <Input
        name="reference"
        placeholder="Payment reference (EFT)"
        required
        className="w-52"
        aria-label="Payment reference"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Working…" : `Mark paid ${formatCents(amountCents)}`}
      </Button>
    </form>
  );
}

/**
 * Shared confirm-with-a-reason dialog. Every consequential action in this
 * page states what it is about to do, names the thing it will do it to, and
 * takes a typed reason that lands on the audit trail.
 */
function ConfirmWithReason({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel,
  confirmLabel,
  destructive,
  pending,
  extraFields,
  hidden,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  reasonLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  extraFields?: React.ReactNode;
  hidden: Record<string, string>;
  onSubmit: (form: FormData) => void;
}) {
  const fieldId = `reason-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" action={onSubmit}>
          {Object.entries(hidden).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          {extraFields}
          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>{reasonLabel}</Label>
            <Input id={fieldId} name="reason" required minLength={4} autoFocus />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Keep as is
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Void, write off or credit an invoice. Until now the day-40 dunning bell
 * told operators to "cancel the service or write off the invoice" with no
 * button anywhere that could do it (§6.3).
 */
export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  customerId,
  customerName,
  outstandingCents,
  hasPayments,
}: {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  outstandingCents: number;
  hasPayments: boolean;
}) {
  const { pending, run } = useRun();
  const [mode, setMode] = useState<"void" | "write_off" | "credit" | null>(null);
  const hidden = { invoiceId, customerId };
  const close = () => setMode(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-label={`Actions for invoice ${invoiceNumber}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setMode("void")}
            disabled={hasPayments}
          >
            {hasPayments
              ? "Cannot void, money was received"
              : "Void invoice…"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMode("write_off")}>
            Write off as bad debt…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMode("credit")}>
            Credit part of it…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmWithReason
        open={mode === "void"}
        onOpenChange={(o) => (o ? setMode("void") : close())}
        title={`Void ${invoiceNumber}?`}
        description={`This cancels ${formatCents(outstandingCents)} owed by ${customerName}, as if the invoice was never issued. Any service suspended only for this invoice comes back automatically. The invoice stays on record as void.`}
        reasonLabel="Why is this invoice being voided?"
        confirmLabel="Void invoice"
        destructive
        pending={pending}
        hidden={hidden}
        onSubmit={(form) =>
          run(() => voidInvoiceAction(form), "Invoice voided", close)
        }
      />

      <ConfirmWithReason
        open={mode === "write_off"}
        onOpenChange={(o) => (o ? setMode("write_off") : close())}
        title={`Write off ${invoiceNumber}?`}
        description={`This accepts that ${formatCents(outstandingCents)} from ${customerName} will not be collected. It leaves the service exactly as it is, so cancel the service separately if that is the decision.`}
        reasonLabel="Why is this debt uncollectable?"
        confirmLabel="Write off"
        destructive
        pending={pending}
        hidden={hidden}
        onSubmit={(form) =>
          run(() => writeOffInvoiceAction(form), "Invoice written off", close)
        }
      />

      <ConfirmWithReason
        open={mode === "credit"}
        onOpenChange={(o) => (o ? setMode("credit") : close())}
        title={`Credit ${invoiceNumber}`}
        description={`Adds a credit line to the invoice and lowers the total. ${formatCents(outstandingCents)} is currently outstanding. To cancel the whole invoice, void it or write it off instead.`}
        reasonLabel="What is the credit for? (shown on the invoice)"
        confirmLabel="Add credit"
        pending={pending}
        hidden={hidden}
        extraFields={
          <div className="space-y-1.5">
            <Label htmlFor={`credit-${invoiceId}`}>Credit amount</Label>
            <Input
              id={`credit-${invoiceId}`}
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              required
              className="tnum"
            />
          </div>
        }
        onSubmit={(form) =>
          run(() => creditInvoiceAction(form), "Credit applied", close)
        }
      />
    </>
  );
}

/**
 * Suspend and cancel both cut a paying customer off, so both confirm in a
 * dialog that names the customer and the service and takes a typed reason.
 * The reason field lives in the dialog, not squeezed into the card's action
 * row, so it is usable at 390px.
 */
export function ServiceActions({
  serviceId,
  customerId,
  status,
  planName,
  customerName,
}: {
  serviceId: string;
  customerId: string;
  status: string;
  planName: string;
  customerName: string;
}) {
  const { pending, run } = useRun();
  const [mode, setMode] = useState<"suspend" | "cancel" | null>(null);
  const hidden = { serviceId, customerId };
  const close = () => setMode(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-label={`Actions for ${planName}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {status === "active" ? (
            <DropdownMenuItem onClick={() => setMode("suspend")}>
              Suspend…
            </DropdownMenuItem>
          ) : null}
          {status === "suspended" ? (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () => reactivateServiceAction(serviceId, customerId),
                  "Service reactivated, provider task created"
                )
              }
            >
              Reactivate
            </DropdownMenuItem>
          ) : null}
          {status !== "cancelled" ? (
            <DropdownMenuItem onClick={() => setMode("cancel")}>
              Cancel (override)…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmWithReason
        open={mode === "suspend"}
        onOpenChange={(o) => (o ? setMode("suspend") : close())}
        title="Suspend this service?"
        description={`This stops ${customerName}'s ${planName} immediately, raises a provider task and notifies the customer. It reverses automatically when everything past due is settled.`}
        reasonLabel="Reason (goes on the audit trail)"
        confirmLabel="Suspend service"
        destructive
        pending={pending}
        hidden={hidden}
        onSubmit={(form) =>
          run(
            () => suspendServiceAction(form),
            "Service suspended, provider task created",
            close
          )
        }
      />

      <ConfirmWithReason
        open={mode === "cancel"}
        onOpenChange={(o) => (o ? setMode("cancel") : close())}
        title="Cancel this service?"
        description={`This overrides the notice period on ${customerName}'s ${planName} and ends it. Billing stops and a provider cancellation task is raised.`}
        reasonLabel="Mandatory override reason"
        confirmLabel="Cancel service"
        destructive
        pending={pending}
        hidden={hidden}
        onSubmit={(form) =>
          run(() => overrideCancelAction(form), "Service cancelled", close)
        }
      />
    </>
  );
}
