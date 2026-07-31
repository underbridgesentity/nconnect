import type { Metadata } from "next";
import { MessageCircle, Phone } from "lucide-react";
import { readDraft } from "@/lib/domain/signup";
import { getSetting } from "@/lib/domain/settings";
import {
  whatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";
import { PillLink } from "@/components/public/pill";

export const metadata: Metadata = {
  title: "We're checking your address",
  robots: { index: false },
};

/**
 * The fibre exit. Repeating the address and the contact details we captured is
 * the only proof the customer gets that the form worked, so it belongs here
 * alongside a way to reach a person.
 *
 * What it promises is what we actually hold: an email reply when an address was
 * given, a phone call when it was not. Naming a channel we cannot use would be
 * the same as promising nothing.
 */
export default async function FeasibilityPromisedPage() {
  const [draft, company] = await Promise.all([
    readDraft(),
    getSetting<CompanySettings>("company"),
  ]);
  const address = draft.address
    ? [
        draft.address.line1,
        draft.address.suburb,
        draft.address.city,
        draft.address.postalCode,
      ]
        .filter(Boolean)
        .join(", ")
    : null;
  const phone = company?.phone ?? null;
  const replyEmail = draft.contact?.email ?? null;
  // Only when settings carry a WhatsApp-capable mobile: the 086 switchboard
  // cannot receive wa.me.
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, I am following up on my fibre feasibility check."
  );

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <MessageCircle className="mx-auto size-10 text-primary" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold">We&apos;re on it.</h1>
      <p className="mt-2 text-muted-foreground">
        We confirm fibre availability at your address within one business day,
        {replyEmail ? " by email" : " by phone"}. Your plan choice is saved,
        once we confirm, signup takes two minutes.
      </p>

      {address || draft.contact?.phone ? (
        <div className="mx-auto mt-6 max-w-sm rounded-2xl border bg-card p-4 text-left text-sm">
          <dl className="space-y-2">
            {address ? (
              <div>
                <dt className="text-muted-foreground">
                  Address we are checking
                </dt>
                <dd className="font-medium">{address}</dd>
              </div>
            ) : null}
            {replyEmail ? (
              <div>
                <dt className="text-muted-foreground">We will email</dt>
                <dd className="font-medium break-all">{replyEmail}</dd>
              </div>
            ) : null}
            {draft.contact?.phone ? (
              <div>
                <dt className="text-muted-foreground">
                  {replyEmail ? "And can reach you on" : "We will call"}
                </dt>
                <dd className="font-medium">{draft.contact.phone}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Not right? Message us and we will fix it before we check.
          </p>
        </div>
      ) : null}

      <p className="mt-6 text-sm text-muted-foreground">
        In the meantime, uncapped LTE works almost everywhere and activates in
        days:
      </p>
      <PillLink
        href="/internet"
        variant="outline"
        className="mx-auto mt-3 flex w-fit"
      >
        See LTE plans
      </PillLink>

      {phone ? (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {wa ? (
            <PillLink href={wa} variant="outline">
              <MessageCircle className="size-4" aria-hidden />
              WhatsApp us
            </PillLink>
          ) : null}
          <PillLink href={`tel:${phone.replace(/\s/g, "")}`} variant="outline">
            <Phone className="size-4" aria-hidden />
            {phone}
          </PillLink>
        </div>
      ) : null}
    </div>
  );
}
