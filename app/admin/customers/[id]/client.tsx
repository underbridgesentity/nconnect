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
import { MoreHorizontal, Pencil } from "lucide-react";
import {
  updateCustomerAction,
  assignRepAction,
  saveNotesAction,
  recordEftAction,
  markOrderPaidManuallyAction,
  suspendServiceAction,
  reactivateServiceAction,
  overrideCancelAction,
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

export function RecordEftForm({
  invoiceId,
  customerId,
  defaultAmountRands,
}: {
  invoiceId: string;
  customerId: string;
  defaultAmountRands: number;
}) {
  const { pending, run } = useRun();
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
      action={(form) => run(() => recordEftAction(form), "EFT recorded")}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="customerId" value={customerId} />
      <Input
        name="amountRands"
        type="number"
        step="0.01"
        defaultValue={defaultAmountRands}
        className="w-28 tnum"
        aria-label="Amount (R)"
      />
      <Input
        name="reference"
        placeholder="EFT reference"
        required
        className="w-44"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Recording…" : "Record EFT"}
      </Button>
    </form>
  );
}

export function MarkOrderPaidForm({
  orderId,
  customerId,
  amountRands,
}: {
  orderId: string;
  customerId: string;
  amountRands: number;
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
      <input type="hidden" name="amountRands" value={amountRands} />
      <Input
        name="reference"
        placeholder="Payment reference (EFT)"
        required
        className="w-52"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Working…" : "Mark paid (EFT)"}
      </Button>
    </form>
  );
}

export function ServiceActions({
  serviceId,
  customerId,
  status,
}: {
  serviceId: string;
  customerId: string;
  status: string;
}) {
  const { pending, run } = useRun();
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              disabled={pending}
              aria-label="Service actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {status === "active" ? (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () =>
                    suspendServiceAction(
                      serviceId,
                      customerId,
                      "Admin manual suspension"
                    ),
                  "Service suspended, provider task created"
                )
              }
            >
              Suspend
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
            <DropdownMenuItem onClick={() => setCancelOpen(true)}>
              Cancel (override)…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {cancelOpen ? (
        <form
          className="mt-2 flex w-full gap-2"
          action={(form) =>
            run(() => overrideCancelAction(form), "Service cancelled", () =>
              setCancelOpen(false)
            )
          }
        >
          <input type="hidden" name="serviceId" value={serviceId} />
          <input type="hidden" name="customerId" value={customerId} />
          <Input
            name="reason"
            placeholder="Mandatory override reason"
            required
            className="flex-1"
          />
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            Confirm
          </Button>
        </form>
      ) : null}
    </>
  );
}
