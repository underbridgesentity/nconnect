"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  updateProfileAction,
  updateMarketingConsentAction,
  requestMyDataAction,
} from "./actions";

export function ProfileForm({
  firstName,
  lastName,
  email,
  phone,
}: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="mt-2 space-y-3"
      action={(form) =>
        startTransition(async () => {
          const r = await updateProfileAction(form);
          if (r.ok) {
            toast.success("Profile saved");
            router.refresh();
          } else toast.error(r.error ?? "Failed");
        })
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" defaultValue={firstName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" defaultValue={lastName} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={email} />
      </div>
      <div className="space-y-1.5">
        <Label>Cellphone (your sign-in)</Label>
        <Input value={phone} disabled />
        <p className="text-xs text-muted-foreground">
          Changing your number needs a quick identity check, ask us in Help.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}

export function MarketingToggles({
  whatsapp,
  email,
}: {
  whatsapp: boolean;
  email: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toggle = (
    kind: "marketing_whatsapp" | "marketing_email",
    granted: boolean
  ) =>
    startTransition(async () => {
      const r = await updateMarketingConsentAction(kind, granted);
      if (r.ok) {
        toast.success("Preference saved");
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });

  return (
    <div className="mt-3 space-y-3">
      <label className="flex items-center justify-between text-sm">
        <span>Deals on WhatsApp</span>
        <Switch
          checked={whatsapp}
          disabled={pending}
          onCheckedChange={(v) => toggle("marketing_whatsapp", v === true)}
        />
      </label>
      <label className="flex items-center justify-between text-sm">
        <span>Deals by email</span>
        <Switch
          checked={email}
          disabled={pending}
          onCheckedChange={(v) => toggle("marketing_email", v === true)}
        />
      </label>
    </div>
  );
}

export function RequestDataButton() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <p className="mt-2 text-sm text-emerald-700">
        Request received, we&apos;ve confirmed by email and will send your
        export soon.
      </p>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-2"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await requestMyDataAction();
          if (r.ok) setDone(true);
          else toast.error(r.error ?? "Failed");
        })
      }
    >
      {pending ? "Sending…" : "Request my data"}
    </Button>
  );
}
