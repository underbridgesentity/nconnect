"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCustomerAction } from "./actions";

export function NewCustomerForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [existingCustomerId, setExistingCustomerId] = useState<string | null>(
    null
  );

  const submit = (form: FormData) =>
    startTransition(async () => {
      setExistingCustomerId(null);
      const result = await createCustomerAction(form);
      if (result.ok) {
        if (result.inviteDetail) toast.warning(result.inviteDetail);
        else
          toast.success(
            result.inviteSent
              ? "Customer created and sign-in email sent"
              : "Customer created"
          );
        router.push(`/admin/customers/${result.customerId}`);
        return;
      }
      if (result.existingCustomerId) {
        setExistingCustomerId(result.existingCustomerId);
      }
      toast.error(result.error);
    });

  return (
    <form action={submit} className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Company (optional)</Label>
        <Input id="companyName" name="companyName" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" required />
        <p className="text-xs text-muted-foreground">
          This is how they sign in: a 6-digit code is emailed to this address.
          There is no password.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Mobile number</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          required
          placeholder="082 123 4567"
        />
        <p className="text-xs text-muted-foreground">
          Required for RICA on any SIM-based service. It is not used to sign in.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="popiaConsent" required className="mt-1" />
        <span>
          The customer has agreed to Needd Connect processing their personal
          information (POPIA). Recorded on their consent trail.
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="sendInvite"
          defaultChecked
          className="mt-1"
        />
        <span>Email them a sign-in link once the account is created.</span>
      </label>

      {existingCustomerId ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          That email address already has an account.{" "}
          <Link
            href={`/admin/customers/${existingCustomerId}`}
            className="font-medium underline"
          >
            Open the existing customer
          </Link>{" "}
          instead of creating a duplicate.
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create customer"}
      </Button>
    </form>
  );
}
