import type { Metadata } from "next";
import Link from "next/link";
import { Phone, Mail, MessageCircle, LifeBuoy } from "lucide-react";
import { getSettingForDisplay } from "@/lib/domain/settings";
import { PageHeader } from "@/components/public/page-header";
import { PillLink } from "@/components/public/pill";
import { WhatsAppPill } from "@/components/public/whatsapp-link";
import {
  whatsappHref,
  whatsappNumber,
  formatMobile,
  type CompanySettings,
} from "@/components/public/whatsapp";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach Needd Connect by email or phone. Existing customers get fastest help through the portal.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact | Needd Connect",
    description:
      "Reach Needd Connect by email or phone. Real South African people, not a call centre.",
    url: "/contact",
    type: "website",
  },
};

export default async function ContactPage() {
  const company = await getSettingForDisplay<CompanySettings>("company");
  const phone = company?.phone ?? null;
  const email = company?.email ?? null;
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, I have a question about your plans."
  );
  const waNumber = whatsappNumber(company);

  // Email first, then the phone, then WhatsApp if and when a real mobile is
  // configured. The order is the promise: email is the channel we answer on
  // every day, WhatsApp is an extra we are adding rather than the front door.
  const tiles = [
    ...(email
      ? [
          {
            href: `mailto:${email}`,
            icon: Mail,
            title: "Email us",
            detail: email,
            body: "The main way we work. Write to us and a person replies.",
          },
        ]
      : []),
    ...(phone
      ? [
          {
            href: `tel:${phone.replace(/\s/g, "")}`,
            icon: Phone,
            title: "Call us",
            detail: phone,
            body: "Office hours, Monday to Friday.",
          },
        ]
      : []),
    ...(wa && waNumber
      ? [
          {
            href: wa,
            icon: MessageCircle,
            title: "WhatsApp",
            detail: formatMobile(waNumber),
            body: "Also available if you would rather chat.",
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        image="/marketing/support.webp"
        imageAlt="A support agent helping a customer over the phone"
        imagePosition="50% 35%"
        eyebrow="Contact"
        title="Talk to a person, not a queue"
        actions={
          <>
            {email ? (
              <PillLink href={`mailto:${email}`}>Email us</PillLink>
            ) : null}
            <PillLink href="/coverage" variant={email ? "ink" : "primary"}>
              Check coverage
            </PillLink>
            {wa ? <WhatsAppPill href={wa} variant="ink" /> : null}
          </>
        }
      >
        <p>
          Sales, support and the awkward questions in between. Email or phone
          us and a South African who knows your account answers, during office
          hours, Monday to Friday.
        </p>
      </PageHeader>

      <div className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-xl font-semibold tracking-tight">
          How to reach us
        </h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => (
            <a
              key={tile.title}
              href={tile.href}
              className="card-hover flex flex-col rounded-3xl border bg-card p-6"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-accent text-primary">
                <tile.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold">{tile.title}</h3>
              <p className="mt-1 text-sm font-medium text-foreground/80">
                {tile.detail}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{tile.body}</p>
            </a>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4 rounded-3xl border bg-card p-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
            <LifeBuoy className="size-5" aria-hidden />
          </span>
          <p className="flex-1 text-sm leading-6 text-foreground/80">
            Already a customer? The fastest route is a conversation in{" "}
            <Link
              href="/portal/help"
              className="font-medium text-primary hover:underline"
            >
              your portal
            </Link>
            , it lands directly with the team that manages your services and
            arrives with your account details attached.
          </p>
        </div>
      </div>
    </>
  );
}
