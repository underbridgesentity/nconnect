import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { isUuid } from "@/app/portal/_lib/uuid";

/** Customer invoice PDF, scoped strictly to the session's customer (§10.1). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const actor = await currentActor();
  if (!actor?.customerId) return new NextResponse("Forbidden", { status: 403 });
  // A clipped or mangled link would otherwise reach a uuid column and 500.
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  if (!invoice || invoice.customerId !== actor.customerId) {
    return new NextResponse("Not found", { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf(id);
  } catch (err) {
    // The customer tapped "PDF" and deserves an answer, not a raw 500.
    console.error(`renderInvoicePdf(${id}) failed:`, err);
    return new NextResponse(
      `We could not build the PDF for invoice ${invoice.number} just now. The amounts and dates are all on your Billing tab, and we can email you a copy if you message us in Help.`,
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.number}.pdf"`,
    },
  });
}
