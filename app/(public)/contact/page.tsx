import type { Metadata } from "next";
import { Phone, Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import { getSetting } from "@/lib/domain/settings";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach Needd Connect on WhatsApp, phone or email. Existing customers get fastest help through the portal.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const company = await getSetting<{ phone: string; email: string }>("company");
  const phone = company?.phone ?? "086 686 3078";
  const email = company?.email ?? "info@needd.co.za";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>
      <p className="mt-2 text-muted-foreground">
        Existing customers: the fastest route is a conversation in{" "}
        <Link href="/portal/help" className="text-primary hover:underline">
          your portal
        </Link>{" "}
       , it lands directly with the team that manages your services.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <a
          href={`https://wa.me/27${phone.replace(/\D/g, "").replace(/^0/, "")}`}
          className="rounded-lg border bg-card p-5 hover:shadow-sm"
        >
          <MessageCircle className="size-5 text-primary" aria-hidden />
          <h2 className="mt-2 font-semibold">WhatsApp</h2>
          <p className="text-sm text-muted-foreground">
            Quickest for sales and support questions.
          </p>
        </a>
        <a
          href={`tel:${phone.replace(/\s/g, "")}`}
          className="rounded-lg border bg-card p-5 hover:shadow-sm"
        >
          <Phone className="size-5 text-primary" aria-hidden />
          <h2 className="mt-2 font-semibold">{phone}</h2>
          <p className="text-sm text-muted-foreground">
            Office hours, Monday to Friday.
          </p>
        </a>
        <a
          href={`mailto:${email}`}
          className="rounded-lg border bg-card p-5 hover:shadow-sm"
        >
          <Mail className="size-5 text-primary" aria-hidden />
          <h2 className="mt-2 font-semibold">{email}</h2>
          <p className="text-sm text-muted-foreground">
            For anything formal or detailed.
          </p>
        </a>
      </div>
    </div>
  );
}
