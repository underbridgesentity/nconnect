import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Phone } from "lucide-react";
import { readDraft } from "@/lib/domain/signup";
import { getSetting } from "@/lib/domain/settings";
import {
  whatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";

export const metadata: Metadata = {
  title: "We're checking your address",
  robots: { index: false },
};

const CTA_SECONDARY =
  "inline-flex touch-target items-center justify-center rounded-full border px-6 text-sm font-medium hover:bg-accent";

/**
 * The fibre exit. Repeating the address and the number we captured is the
 * only proof the customer gets that the form worked, so it belongs here
 * alongside a way to reach a person.
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
  // Only when settings carry a WhatsApp-capable mobile: the 086 switchboard
  // cannot receive wa.me, and this page promises a WhatsApp reply.
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
        on WhatsApp. Your plan choice is saved, once we confirm, signup takes
        two minutes.
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
            {draft.contact?.phone ? (
              <div>
                <dt className="text-muted-foreground">We will message</dt>
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
      <Link href="/internet" className={`mx-auto mt-3 flex w-fit ${CTA_SECONDARY}`}>
        See LTE plans
      </Link>

      {phone ? (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {wa ? (
            <a href={wa} className={CTA_SECONDARY}>
              <MessageCircle className="mr-2 size-4" aria-hidden />
              WhatsApp us
            </a>
          ) : null}
          <a href={`tel:${phone.replace(/\s/g, "")}`} className={CTA_SECONDARY}>
            <Phone className="mr-2 size-4" aria-hidden />
            {phone}
          </a>
        </div>
      ) : null}
    </div>
  );
}
