import "server-only";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { normalizePhone } from "@/lib/auth/otp";

/**
 * Lead capture (spec §4.6). Public flows (coverage, abandoned signup) create
 * leads without an actor; staff flows pass one. Every lead lands in the
 * admin/sales queues.
 */

const leadInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(9).max(15),
  email: z.string().email().nullish(),
  source: z.enum(leads.source.enumValues),
  interest: z.string().max(500).nullish(),
  addressText: z.string().max(500).nullish(),
});

export async function createLead(
  input: z.infer<typeof leadInput>
): Promise<string> {
  const data = leadInput.parse(input);
  const phone = normalizePhone(data.phone);

  const eventId = await db.transaction(async (tx) => {
    const [lead] = await tx
      .insert(leads)
      .values({ ...data, phone })
      .returning({ id: leads.id });
    await writeAudit(tx, {
      actor: null,
      action: "lead.create",
      entity: "lead",
      entityId: lead.id,
      after: { ...data, phone },
    });
    return emitDomainEvent(tx, "lead.created", {
      leadId: lead.id,
      source: data.source,
    });
  });
  await forwardDomainEvent(eventId);
  return eventId;
}
