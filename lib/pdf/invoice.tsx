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
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices, invoiceLines, customers, payments } from "@/lib/db/schema";
import { formatCents } from "@/lib/money";
import { getSetting } from "@/lib/domain/settings";
import { isTaxInvoice, vatLineLabel } from "@/lib/domain/vat";

const BRAND_BLUE = "#136FB0";
const INK = "#121829";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  logo: { width: 130, height: 19 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 18 },
  muted: { color: "#71717a" },
  small: { fontSize: 8.5, color: "#71717a" },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: BRAND_BLUE,
    color: "#fff",
    fontFamily: "Helvetica-Bold",
    padding: 6,
    marginTop: 18,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e4e7",
    padding: 6,
  },
  cDesc: { flex: 4 },
  cAmt: { flex: 1.2, textAlign: "right" },
  cVat: { flex: 1, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
    gap: 24,
  },
  statusPaid: {
    color: "#059669",
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
  },
  statusOpen: {
    color: "#d97706",
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    fontSize: 7.5,
    color: "#71717a",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#e4e4e7",
    paddingTop: 6,
  },
  bankBox: {
    marginTop: 18,
    padding: 10,
    borderWidth: 0.5,
    borderColor: "#e4e4e7",
    borderRadius: 4,
  },
});

type Company = {
  legalName: string;
  website: string;
  phone: string;
  email: string;
  vat: string;
  reg: string;
  bbbee: string;
};
type Banking = {
  bank: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
  reference: string;
};

export async function renderInvoicePdf(invoiceId: string): Promise<Buffer> {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new Error("Invoice not found");
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, invoice.customerId))
    .limit(1);
  const lines = await db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));
  const [company, banking] = await Promise.all([
    getSetting<Company>("company"),
    getSetting<Banking>("banking"),
  ]);

  /*
   * Whether this document is a tax invoice is decided by the invoice itself,
   * never by today's settings. The rate was snapshotted when it was issued, so
   * an invoice raised before the company registered stays a plain invoice
   * forever: no VAT number, no split, nothing claimed that was not charged.
   * Registering later cannot retroactively turn old documents into tax
   * invoices, which is exactly right.
   */
  const carriesVat = isTaxInvoice(invoice);
  const vatRate = invoice.vatRateBasisPoints;
  const vatCents = invoice.vatCents;
  const documentLabel = carriesVat ? "Tax invoice" : "Invoice";

  const logoPath = path.join(process.cwd(), "public/brand/logo-dark.png");
  const customerName =
    customer.companyName ??
    [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  const isPaid = invoice.status === "paid";
  const dateFmt = new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeZone: "Africa/Johannesburg",
  });

  const doc = (
    <Document
      title={`${documentLabel} ${invoice.number}`}
      author={company?.legalName}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.row}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image */}
          <Image src={logoPath} style={styles.logo} />
          <View style={{ textAlign: "right" }}>
            <Text style={isPaid ? styles.statusPaid : styles.statusOpen}>
              {isPaid ? "PAID" : invoice.status === "past_due" ? "OVERDUE" : "DUE"}
            </Text>
          </View>
        </View>

        <Text style={styles.h1}>
          {documentLabel} {invoice.number}
        </Text>
        <View style={[styles.row, { marginTop: 14 }]}>
          <View>
            <Text style={styles.muted}>Billed to</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{customerName}</Text>
            {customer.email ? <Text>{customer.email}</Text> : null}
            {customer.phone ? <Text>{customer.phone}</Text> : null}
          </View>
          <View style={{ textAlign: "right" }}>
            <Text style={styles.muted}>Issued</Text>
            <Text>{dateFmt.format(new Date(invoice.issueDate))}</Text>
            <Text style={[styles.muted, { marginTop: 4 }]}>Due</Text>
            <Text>{dateFmt.format(new Date(invoice.dueDate))}</Text>
            {invoice.periodStart && invoice.periodEnd ? (
              <>
                <Text style={[styles.muted, { marginTop: 4 }]}>Period</Text>
                <Text>
                  {dateFmt.format(new Date(invoice.periodStart))}, {" "}
                  {dateFmt.format(new Date(invoice.periodEnd))}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.cDesc}>Description</Text>
          <Text style={styles.cAmt}>
            {carriesVat ? "Amount excl. VAT" : "Amount"}
          </Text>
          {carriesVat ? <Text style={styles.cVat}>VAT</Text> : null}
        </View>
        {lines.map((line) => (
          <View key={line.id} style={styles.tableRow}>
            <Text style={styles.cDesc}>{line.description}</Text>
            <Text style={styles.cAmt}>{formatCents(line.amountCents)}</Text>
            {carriesVat ? (
              <Text style={styles.cVat}>
                {line.vatCents === null ? "-" : formatCents(line.vatCents)}
              </Text>
            ) : null}
          </View>
        ))}
        {/*
          A South African tax invoice has to state the VAT amount and the rate,
          so when this document carries VAT the subtotal and the VAT stand on
          their own lines above the total. Line amounts are stored excluding
          VAT, so the column above sums exactly to the subtotal here.
        */}
        {carriesVat && vatCents !== null && vatRate !== null ? (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.muted}>Subtotal excl. VAT</Text>
              <Text>{formatCents(invoice.subtotalCents)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.muted}>{vatLineLabel(vatRate)}</Text>
              <Text>{formatCents(vatCents)}</Text>
            </View>
          </>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            {carriesVat ? "Total incl. VAT" : "Total"}
          </Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>
            {formatCents(invoice.totalCents)}
          </Text>
        </View>
        {paymentRows
          .filter((p) => p.status === "complete")
          .map((p) => (
            <View key={p.id} style={styles.totalRow}>
              <Text style={styles.muted}>
                Paid{" "}
                {p.method === "eft_manual"
                  ? "(EFT)"
                  : p.method === "payfast_token"
                    ? "(card on file)"
                    : "(card)"}
              </Text>
              <Text style={styles.muted}>{formatCents(p.amountCents)}</Text>
            </View>
          ))}

        {!isPaid && banking ? (
          <View style={styles.bankBox}>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>
              Pay by EFT
            </Text>
            <Text>
              {banking.bank} | {banking.accountName}
            </Text>
            <Text>
              Account {banking.accountNumber} | Branch {banking.branchCode}
            </Text>
            <Text>Reference: {invoice.number}</Text>
          </View>
        ) : null}

        {/*
          The VAT registration number appears only on a document that actually
          carries VAT. Printing it beside a total with no VAT breakdown reads
          as a tax invoice while failing to be one, which is worse than
          printing neither, so on a non-VAT invoice it is simply absent.
        */}
        {company ? (
          <Text style={styles.footer} fixed>
            {company.legalName} | {company.website} | {company.phone} |{" "}
            {company.email} |{" "}
            {carriesVat && company.vat ? `VAT: ${company.vat} | ` : ""}Reg:{" "}
            {company.reg} | {company.bbbee}
          </Text>
        ) : null}
      </Page>
    </Document>
  );

  const buffer = await renderToBuffer(doc);
  return Buffer.from(buffer);
}
