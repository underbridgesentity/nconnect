"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/app/portal/_lib/run-action";
import {
  updateProfileAction,
  requestEmailChangeAction,
  confirmEmailChangeAction,
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
    <div className="mt-2 space-y-3">
      <form
        className="space-y-3"
        action={(form) =>
          startTransition(async () => {
            const r = await runAction(() => updateProfileAction(form));
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
        <Button type="submit" className="touch-target" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </form>
      <ChangeEmail email={email} />
      <div className="space-y-1.5">
        <Label htmlFor="phone">Cellphone number (required for RICA)</Label>
        <Input id="phone" value={phone} disabled />
        <p className="text-xs text-muted-foreground">
          We keep a working number on file because RICA requires one. To change
          it, ask us in Help.
        </p>
      </div>
    </div>
  );
}

/**
 * The email address is the sign-in credential, so it does not save like a
 * name: we email a code to the new address first, and only a correct code
 * changes anything.
 */
function ChangeEmail({ email }: { email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"closed" | "address" | "code">("closed");
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");

  const sendCode = (resend: boolean) =>
    startTransition(async () => {
      const r = await runAction(() =>
        requestEmailChangeAction({ newEmail })
      );
      if (r.ok && r.email) {
        setSentTo(r.email);
        setStep("code");
        toast.success(
          resend
            ? `New code sent to ${r.email}`
            : `Code sent to ${r.email}`
        );
      } else toast.error(r.error ?? "Failed");
    });

  const confirm = () =>
    startTransition(async () => {
      const r = await runAction(() =>
        confirmEmailChangeAction({ newEmail: sentTo, code })
      );
      if (r.ok) {
        toast.success("Sign-in email updated");
        setStep("closed");
        setNewEmail("");
        setSentTo("");
        setCode("");
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });

  return (
    <div className="space-y-1.5">
      <Label htmlFor="email">Email (your sign-in)</Label>
      <Input id="email" type="email" value={email} disabled />
      {step === "closed" ? (
        <>
          <p className="text-xs text-muted-foreground">
            This is the address you sign in with and where your invoices go.
            Changing it starts with a code emailed to the new address.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch-target"
            onClick={() => setStep("address")}
          >
            Change email
          </Button>
        </>
      ) : null}
      {step === "address" ? (
        <div className="space-y-1.5 rounded-xl border p-3">
          <Label htmlFor="newEmail">New email address</Label>
          <Input
            id="newEmail"
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="thandi@example.com"
          />
          <p className="text-xs text-muted-foreground">
            We&apos;ll email a 6-digit code to this address to make sure it
            works before we switch anything.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="touch-target"
              disabled={pending || !newEmail.trim()}
              onClick={() => sendCode(false)}
            >
              {pending ? "Sending…" : "Send code"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch-target"
              disabled={pending}
              onClick={() => {
                setStep("closed");
                setNewEmail("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {step === "code" ? (
        <div className="space-y-1.5 rounded-xl border p-3">
          <Label htmlFor="emailChangeCode">
            Enter the code we emailed to {sentTo}
          </Label>
          <Input
            id="emailChangeCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="touch-target"
              disabled={pending || code.length !== 6}
              onClick={confirm}
            >
              {pending ? "Checking…" : "Confirm new email"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch-target"
              disabled={pending}
              onClick={() => sendCode(true)}
            >
              Resend code
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="touch-target"
              disabled={pending}
              onClick={() => {
                setStep("closed");
                setNewEmail("");
                setSentTo("");
                setCode("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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
      const r = await runAction(() =>
        updateMarketingConsentAction(kind, granted)
      );
      if (r.ok) {
        toast.success("Preference saved");
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });

  // Base UI's Switch renders an element with role="switch", not a labelable
  // control, so a wrapping <label> would name nothing. Point the switch at the
  // text with aria-labelledby instead.
  return (
    <div className="mt-3 space-y-3">
      <div className="flex touch-target items-center justify-between text-sm">
        <span id="marketing-whatsapp-label">Deals on WhatsApp</span>
        <Switch
          id="marketing-whatsapp"
          aria-labelledby="marketing-whatsapp-label"
          checked={whatsapp}
          disabled={pending}
          onCheckedChange={(v) => toggle("marketing_whatsapp", v === true)}
        />
      </div>
      <div className="flex touch-target items-center justify-between text-sm">
        <span id="marketing-email-label">Deals by email</span>
        <Switch
          id="marketing-email"
          aria-labelledby="marketing-email-label"
          checked={email}
          disabled={pending}
          onCheckedChange={(v) => toggle("marketing_email", v === true)}
        />
      </div>
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
      className="mt-2 touch-target"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await runAction(() => requestMyDataAction());
          if (r.ok) setDone(true);
          else toast.error(r.error ?? "Failed");
        })
      }
    >
      {pending ? "Sending…" : "Request my data"}
    </Button>
  );
}
