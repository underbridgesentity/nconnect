import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { customers, addresses, consents } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { SignOutButton } from "@/components/shared/sign-out-button";
import {
  ProfileForm,
  MarketingToggles,
  RequestDataButton,
} from "./client";

export const metadata: Metadata = { title: "Account" };

export default async function PortalAccountPage() {
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, actor.customerId))
    .limit(1);
  if (!customer) redirect("/login");

  const [addressRows, consentRows] = await Promise.all([
    db
      .select()
      .from(addresses)
      .where(eq(addresses.customerId, actor.customerId)),
    db
      .select()
      .from(consents)
      .where(eq(consents.customerId, actor.customerId))
      .orderBy(desc(consents.capturedAt)),
  ]);

  // Latest state per consent kind (history preserved in the table).
  const latest = new Map<string, (typeof consentRows)[number]>();
  for (const row of consentRows) {
    if (!latest.has(row.kind)) latest.set(row.kind, row);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Account</h1>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Profile</h2>
        <ProfileForm
          firstName={customer.firstName ?? ""}
          lastName={customer.lastName ?? ""}
          email={customer.email ?? ""}
          phone={customer.phone ?? ""}
        />
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Addresses</h2>
        {addressRows.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No addresses on file.
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {addressRows.map((a) => (
              <li key={a.id}>
                {[a.line1, a.line2, a.suburb, a.city, a.postalCode]
                  .filter(Boolean)
                  .join(", ")}
                {a.isPrimary ? " (primary)" : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Moving? Tell us in a Help conversation, service addresses affect
          coverage, so a human double-checks the change.
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Notifications & marketing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Service messages (invoices, activations, outages) always reach you, they&apos;re part of running your service. Marketing is up to you:
        </p>
        <MarketingToggles
          whatsapp={latest.get("marketing_whatsapp")?.granted ?? false}
          email={latest.get("marketing_email")?.granted ?? false}
        />
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Consent history</h2>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          {consentRows.slice(0, 8).map((c) => (
            <li key={c.id}>
              {formatDateTime(c.capturedAt)}, {c.kind.replace(/_/g, " ")}:{" "}
              {c.granted ? "granted" : "declined"}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Your data (POPIA)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Request a copy of the personal information we hold about you. We
          confirm in writing and send the export. RICA records are retained 5
          years after service termination, as the law requires.
        </p>
        <RequestDataButton />
      </section>

      <div className="flex justify-center pb-4">
        <SignOutButton />
      </div>
    </div>
  );
}
