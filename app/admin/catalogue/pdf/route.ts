import { NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { renderCataloguePdf } from "@/lib/pdf/catalogue";

export async function GET() {
  const actor = await currentActor();
  if (!actor || actor.role !== "admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const pdf = await renderCataloguePdf();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="needd-connect-catalogue-${date}.pdf"`,
    },
  });
}
