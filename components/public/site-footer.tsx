import Image from "next/image";
import Link from "next/link";
import { getSettingForDisplay } from "@/lib/domain/settings";
import {
  COMPANY_NAV,
  LEGAL_NAV,
  PRIMARY_NAV,
  type NavItem,
} from "@/components/public/nav-items";

type Company = {
  legalName: string;
  website: string;
  phone: string;
  email: string;
  vat: string;
  reg: string;
  bbbee: string;
};

const LINK =
  "inline-flex min-h-9 items-center rounded-full text-sm text-white/60 transition-colors hover:text-white";

/**
 * The ink closing block (spec §11 design language).
 *
 * The page ends on the same #121829 the heroes open with, so the site closes
 * on brand instead of fading into another light card. Fully server rendered:
 * the company details come from settings, and every field is guarded, because
 * an unseeded install must show nothing rather than a placeholder VAT number.
 */
export async function SiteFooter() {
  const company = await getSettingForDisplay<Company>("company");

  return (
    <footer data-surface="ink" className="bg-[#121829] text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1.1fr] lg:gap-12">
        <div>
          <Image
            src="/brand/logo-white.png"
            alt="Needd Connect"
            width={140}
            height={21}
            className="h-[21px] w-auto"
          />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/60">
            One provider, one bill, local support. Accredited reseller of MTN,
            Vodacom and Telkom, with fibre on Openserve, Vumatel, Frogfoot and
            MetroFibre.
          </p>
          {company ? (
            <ul className="mt-6 space-y-1">
              <li>
                <a
                  href={`tel:${company.phone.replace(/\s/g, "")}`}
                  className="inline-flex min-h-9 items-center text-sm font-semibold text-white transition-colors hover:text-white/70"
                >
                  {company.phone}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${company.email}`}
                  className="inline-flex min-h-9 items-center text-sm font-semibold text-white transition-colors hover:text-white/70"
                >
                  {company.email}
                </a>
              </li>
            </ul>
          ) : null}
        </div>

        <FooterColumn title="Products" items={PRIMARY_NAV} />
        <FooterColumn title="Company" items={COMPANY_NAV} extra={SIGN_IN} />
        <FooterColumn title="Legal" items={LEGAL_NAV} />
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {company?.legalName ?? "Needd Technology Solutions (Pty) Ltd"}
          </p>
          {company ? (
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <li>
                Reg <span className="tnum">{company.reg}</span>
              </li>
              <li>
                VAT <span className="tnum">{company.vat}</span>
              </li>
              <li>{company.bbbee}</li>
            </ul>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

const SIGN_IN: NavItem = { href: "/login", label: "Sign in" };

function FooterColumn({
  title,
  items,
  extra,
}: {
  title: string;
  items: NavItem[];
  extra?: NavItem;
}) {
  const links = extra ? [...items, extra] : items;
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
        {title}
      </h2>
      <ul className="mt-3 space-y-0.5">
        {links.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className={LINK}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
