import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { renderInvoicePdf } from "@/lib/pdf/invoice";

/** Customer invoice PDF — scoped strictly to the session's customer (§10.1). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const actor = await currentActor();
  if (!actor?.customerId) return new NextResponse("Forbidden", { status: 403 });

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  if (!invoice || invoice.customerId !== actor.customerId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const pdf = await renderInvoicePdf(id);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.number}.pdf"`,
    },
  });
}
