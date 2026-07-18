import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";

function csvField(value: string | null): string {
  if (value == null) return "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function GET() {
  const actor = await currentActor();
  if (!actor || actor.role !== "admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const rows = await db
    .select()
    .from(customers)
    .orderBy(desc(customers.createdAt));

  const header =
    "first_name,last_name,company,type,phone,email,source,status,created_at";
  const lines = rows.map((c) =>
    [
      csvField(c.firstName),
      csvField(c.lastName),
      csvField(c.companyName),
      c.type,
      csvField(c.phone),
      csvField(c.email),
      c.source,
      c.status,
      c.createdAt.toISOString(),
    ].join(",")
  );
  return new NextResponse([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="needd-customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
