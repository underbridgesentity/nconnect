"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/shared/status-pill";
import {
  updateCompanyAction,
  updateBankingAction,
  inviteStaffAction,
  staffStatusAction,
  staffRoleAction,
  testSendAction,
  type Result,
} from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success + (r.detail ? ` (${r.detail})` : ""));
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });
  return { pending, run };
}

export function CompanyForm({ company }: { company: Record<string, string> }) {
  const { pending, run } = useRun();
  const fields: [string, string][] = [
    ["legalName", "Legal name"],
    ["website", "Website"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["vat", "VAT number"],
    ["reg", "Company registration"],
    ["bbbee", "B-BBEE status"],
  ];
  return (
    <form
      className="space-y-3 rounded-lg border bg-card p-4"
      action={(form) => run(() => updateCompanyAction(form), "Company details saved")}
    >
      <h2 className="text-sm font-semibold">Company details</h2>
      {fields.map(([name, label]) => (
        <div key={name} className="space-y-1">
          <Label htmlFor={`company-${name}`} className="text-xs">
            {label}
          </Label>
          <Input
            id={`company-${name}`}
            name={name}
            defaultValue={company[name] ?? ""}
          />
        </div>
      ))}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function BankingForm({ banking }: { banking: Record<string, string> }) {
  const { pending, run } = useRun();
  const fields: [string, string][] = [
    ["bank", "Bank"],
    ["accountName", "Account name"],
    ["accountNumber", "Account number"],
    ["branchCode", "Branch code"],
  ];
  return (
    <form
      className="space-y-3 rounded-lg border bg-card p-4"
      action={(form) => run(() => updateBankingAction(form), "Banking details saved")}
    >
      <h2 className="text-sm font-semibold">EFT banking details</h2>
      <p className="text-xs text-muted-foreground">
        Shown on unpaid invoice PDFs. Reference is always the invoice number.
      </p>
      {fields.map(([name, label]) => (
        <div key={name} className="space-y-1">
          <Label htmlFor={`bank-${name}`} className="text-xs">
            {label}
          </Label>
          <Input id={`bank-${name}`} name={name} defaultValue={banking[name] ?? ""} />
        </div>
      ))}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function InviteStaffForm() {
  const { pending, run } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3"
      action={(form) => run(() => inviteStaffAction(form), "Invitation sent")}
    >
      <div className="min-w-40 flex-1 space-y-1">
        <Label htmlFor="invite-name" className="text-xs">
          Name
        </Label>
        <Input id="invite-name" name="name" required />
      </div>
      <div className="min-w-52 flex-1 space-y-1">
        <Label htmlFor="invite-email" className="text-xs">
          Email
        </Label>
        <Input id="invite-email" name="email" type="email" required />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Role</Label>
        <Select name="role" defaultValue="sales">
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </Button>
    </form>
  );
}

export function StaffRow({
  user,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "sales";
    status: string;
  };
}) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <div>
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={user.role}
          onValueChange={(v) =>
            run(() => staffRoleAction(user.id, v as "admin" | "sales"), "Role updated")
          }
          disabled={pending}
        >
          <SelectTrigger className="h-8 w-24 text-xs" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <StatusPill status={user.status} />
        {user.status === "disabled" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => staffStatusAction(user.id, "active"), "Re-enabled")
            }
          >
            Enable
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => staffStatusAction(user.id, "disabled"), "Disabled")
            }
          >
            Disable
          </Button>
        )}
      </div>
    </div>
  );
}

export function TestSendPanel() {
  const { pending, run } = useRun();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [to, setTo] = useState("");
  return (
    <div className="rounded-lg border bg-card p-3">
      <h2 className="text-sm font-semibold">Test send</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select value={channel} onValueChange={(v) => setChannel(v as "email")}>
          <SelectTrigger className="w-28" aria-label="Channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={channel === "email" ? "you@needd.co.za" : "0821234567"}
          className="w-56"
          aria-label="Recipient"
        />
        <Button
          size="sm"
          disabled={pending || !to}
          onClick={() => run(() => testSendAction(channel, to), "Test sent")}
        >
          {pending ? "Sending…" : "Send test"}
        </Button>
      </div>
    </div>
  );
}
