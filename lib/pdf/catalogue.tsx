import "server-only";
import path from "node:path";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { formatCents } from "@/lib/money";
import {
  publishedPlans,
  publishedHardware,
  type PlanWithProvider,
} from "@/lib/domain/catalogue";
import { getSetting } from "@/lib/domain/settings";
import {
  VAT_SETTING_KEY,
  parseVatSettings,
  pricingTermsSentence,
} from "@/lib/domain/vat";

/**
 * On-demand PDF catalogue (spec §9.4.3): renders the current published
 * catalogue so the drifting static PDF is permanently replaced. Same records
 * as the public site.
 */

const BRAND_BLUE = "#136FB0";
const INK = "#121829";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  logo: { width: 120, height: 18, marginBottom: 6 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 14,
  },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 9, color: "#52525b", marginTop: 2 },
  sectionBar: {
    backgroundColor: INK,
    color: "#ffffff",
    padding: 6,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 6,
  },
  groupTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: BRAND_BLUE,
    marginTop: 8,
    marginBottom: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: BRAND_BLUE,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    padding: 4,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e4e7",
    padding: 4,
  },
  cName: { flex: 3 },
  cSmall: { flex: 1.2 },
  cWide: { flex: 3.4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#71717a",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e4e4e7",
    paddingTop: 6,
  },
  note: { fontSize: 7.5, color: "#71717a", marginTop: 3 },
});

const CATEGORY_TITLES: Record<string, string> = {
  lte_home: "Home Internet (Uncapped LTE/5G)",
  telkom_lte: "Telkom Uncapped LTE",
  fibre: "Fibre Packages",
  voip: "Voice (VoIP) Services",
  sim_data: "Mobile & Router Data (SIM-Only)",
};

const HW_TITLES: Record<string, string> = {
  router_lte: "Mobile / LTE Routers",
  router_5g: "5G Routers",
  router_fibre: "Fibre Routers",
  mesh: "Mesh Wi-Fi Systems",
  extender: "Range Extenders",
  voip_phone: "VoIP Handsets",
  power: "Back-Up Power",
  accessory: "Accessories",
};

function PlanTable({ plans: rows }: { plans: PlanWithProvider[] }) {
  return (
    <View>
      <View style={styles.tableHeader}>
        <Text style={styles.cName}>Package</Text>
        <Text style={styles.cSmall}>Monthly</Text>
        <Text style={styles.cSmall}>Once-off</Text>
        <Text style={styles.cWide}>Details</Text>
      </View>
      {rows.map((p) => (
        <View key={p.id} style={styles.row} wrap={false}>
          <Text style={styles.cName}>{p.name}</Text>
          <Text style={styles.cSmall}>{formatCents(p.priceCents, { whole: true })}</Text>
          <Text style={styles.cSmall}>
            {p.onceOffCents > 0 ? formatCents(p.onceOffCents, { whole: true }) : "-"}
          </Text>
          <Text style={styles.cWide}>{p.dataAllocation ?? p.description ?? ""}</Text>
        </View>
      ))}
    </View>
  );
}

export async function renderCataloguePdf(): Promise<Buffer> {
  const [allPlans, hardware, company, storedVat] = await Promise.all([
    publishedPlans(),
    publishedHardware(),
    getSetting<{
      legalName: string;
      website: string;
      phone: string;
      email: string;
      vat: string;
      reg: string;
      bbbee: string;
    }>("company"),
    getSetting<unknown>(VAT_SETTING_KEY),
  ]);
  /*
   * A price list carrying a VAT registration number is making a statement
   * about the prices beside it. While the company is not registered the number
   * is left off and the sheet says plainly that no VAT is charged, so the
   * catalogue can never imply a VAT treatment the invoices do not apply.
   */
  const vat = parseVatSettings(storedVat);
  const pricingSentence = pricingTermsSentence(vat);

  const logoPath = path.join(process.cwd(), "public/brand/logo-dark.png");
  const generatedOn = new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date());

  const byCategory = (cat: string) => allPlans.filter((p) => p.category === cat);
  const hwByCategory = (cat: string) => hardware.filter((h) => h.category === cat);

  const vatPart =
    vat.registered && company?.vat ? `  |  VAT: ${company.vat}` : "";
  const footerText = company
    ? `${company.legalName}  |  ${company.website}  |  ${company.phone}  |  ${company.email}${vatPart}  |  Reg: ${company.reg}  |  ${company.bbbee}`
    : "Needd Technology Solutions (Pty) Ltd";

  const doc = (
    <Document
      title="Needd Connect Services Catalogue"
      author="Needd Technology Solutions (Pty) Ltd"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
          <Image src={logoPath} style={styles.logo} />
          <Text style={styles.subtitle}>
            Generated {generatedOn}, always current
          </Text>
        </View>
        <Text style={styles.title}>Needd Connect Services Catalogue</Text>
        <Text style={styles.subtitle}>
          Your partner for reliable, affordable & tailored connectivity
        </Text>
        <Text style={styles.subtitle}>{pricingSentence}</Text>

        {(["lte_home", "telkom_lte", "fibre", "voip", "sim_data"] as const).map(
          (cat) => {
            const rows = byCategory(cat);
            if (rows.length === 0) return null;
            return (
              <View key={cat}>
                <Text style={styles.sectionBar}>{CATEGORY_TITLES[cat]}</Text>
                <PlanTable plans={rows} />
                {cat === "lte_home" ? (
                  <Text style={styles.note}>
                    * Router must be network approved and bought upfront. No
                    contracts, instant activation, nationwide coverage. 5G
                    coverage subject to area.
                  </Text>
                ) : null}
                {cat === "fibre" ? (
                  <Text style={styles.note}>
                    * Coverage subject to area, contact us to verify fibre
                    availability at your address. All packages uncapped and
                    unshaped.
                  </Text>
                ) : null}
                {cat === "sim_data" ? (
                  <Text style={styles.note}>
                    * SIM-only packages on a 24-month subscription; data split
                    equally between day and night bundles. Router sold
                    separately.
                  </Text>
                ) : null}
              </View>
            );
          }
        )}

        <Text style={styles.footer} fixed>
          {footerText}
        </Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionBar}>Router (Device) Pricing</Text>
        {Object.keys(HW_TITLES).map((cat) => {
          const rows = hwByCategory(cat);
          if (rows.length === 0) return null;
          return (
            <View key={cat}>
              <Text style={styles.groupTitle}>{HW_TITLES[cat]}</Text>
              <View style={styles.tableHeader}>
                <Text style={styles.cName}>Device</Text>
                <Text style={styles.cSmall}>Price</Text>
                <Text style={styles.cWide}>Key features</Text>
              </View>
              {rows.map((h) => (
                <View key={h.id} style={styles.row} wrap={false}>
                  <Text style={styles.cName}>{h.name}</Text>
                  <Text style={styles.cSmall}>
                    {formatCents(h.priceCents, { whole: true })}
                  </Text>
                  <Text style={styles.cWide}>{h.description ?? ""}</Text>
                </View>
              ))}
            </View>
          );
        })}
        <Text style={styles.footer} fixed>
          {footerText}
        </Text>
      </Page>
    </Document>
  );

  const buffer = await renderToBuffer(doc);
  return Buffer.from(buffer);
}
