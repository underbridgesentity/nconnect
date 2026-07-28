"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { db } from "@/lib/db/client";
import { plans, hardwareProducts } from "@/lib/db/schema";
import { writeAudit } from "@/lib/domain/audit";
import { emitDomainEvent } from "@/lib/domain/events";
import {
  upsertPlan,
  setPlanStatus,
  upsertHardware,
  setHardwareStatus,
  upsertBundle,
  setBundleStatus,
} from "@/lib/domain/catalogue";
import { uploadFile, randomFileName } from "@/lib/storage";
import { parseZar } from "@/lib/money";
import {
  bundleItemsToInput,
  requirePriceCents,
  type BundleItemDraft,
} from "./pricing";

export type { BundleItemDraft };

export type ActionResult = { ok: boolean; error?: string };

function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : "Failed" };
}

/**
 * Prices off a form are text, never floats. `Number("1 200") * 100` is NaN
 * and would land straight in an integer cents column; `parseZar` reads the
 * formats people actually type and throws on anything else.
 */
function num(form: FormData, key: string): number {
  const value = String(form.get(key) ?? "").trim();
  if (value === "") return 0;
  let cents: number;
  try {
    cents = parseZar(value);
  } catch {
    throw new Error(`"${value}" is not a valid amount, for example 388.00`);
  }
  // A price column is non-negative in the schema, so catch it here where the
  // message can name the amount rather than surfacing a zod path.
  if (cents < 0) throw new Error(`"${value}" must be a positive amount`);
  return cents;
}

function optNum(form: FormData, key: string): number | null {
  const value = String(form.get(key) ?? "").trim();
  if (value === "") return null;
  return num(form, key);
}

function optInt(form: FormData, key: string): number | null {
  const v = String(form.get(key) ?? "").trim();
  return v === "" ? null : parseInt(v, 10);
}

export async function savePlanAction(form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await upsertPlan(actor, {
      id: (form.get("id") as string) || undefined,
      providerId: String(form.get("providerId")),
      category: String(form.get("category")) as never,
      name: String(form.get("name")),
      slug: String(form.get("slug")),
      description: String(form.get("description") ?? "") || null,
      speedDownMbps: optInt(form, "speedDownMbps"),
      speedUpMbps: optInt(form, "speedUpMbps"),
      dataAllocation: String(form.get("dataAllocation") ?? "") || null,
      fupDetail: String(form.get("fupDetail") ?? "") || null,
      contractMonths: optInt(form, "contractMonths"),
      priceCents: num(form, "priceRands"),
      costCents: optNum(form, "costRands"),
      onceOffCents: num(form, "onceOffRands"),
      onceOffCostCents: optNum(form, "onceOffCostRands"),
      featured: form.get("featured") === "on",
      sortOrder: optInt(form, "sortOrder") ?? 0,
      metadata: {},
    });
    revalidatePath("/admin/catalogue");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setPlanStatusAction(
  planId: string,
  status: "draft" | "published" | "archived"
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await setPlanStatus(actor, planId, status);
    revalidatePath("/admin/catalogue");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveHardwareAction(form: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActor();

    let imagePath: string | null =
      String(form.get("existingImagePath") ?? "") || null;
    const image = form.get("image") as File | null;
    if (image && image.size > 0) {
      const input = Buffer.from(await image.arrayBuffer());
      const meta = await sharp(input).metadata();
      if (!meta.width || meta.width < 800) {
        return {
          ok: false,
          error: `Image must be at least 800px wide (got ${meta.width ?? 0}px).`,
        };
      }
      // Spec §9.4.3: enforce min 800px and convert to webp.
      const webp = await sharp(input)
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer();
      const fileName = `hardware/${randomFileName(".webp")}`;
      await uploadFile("catalogue", fileName, webp, "image/webp");
      imagePath = fileName;
    }

    await upsertHardware(actor, {
      id: (form.get("id") as string) || undefined,
      sku: String(form.get("sku")),
      name: String(form.get("name")),
      category: String(form.get("category")) as never,
      description: String(form.get("description") ?? "") || null,
      specs: {},
      priceCents: num(form, "priceRands"),
      costCents: optNum(form, "costRands"),
      stockQty: optInt(form, "stockQty") ?? 0,
      lowStockThreshold: optInt(form, "lowStockThreshold") ?? 3,
      imagePath,
      sortOrder: optInt(form, "sortOrder") ?? 0,
    });
    revalidatePath("/admin/catalogue");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setHardwareStatusAction(
  hardwareId: string,
  status: "draft" | "published" | "archived"
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await setHardwareStatus(actor, hardwareId, status);
    revalidatePath("/admin/catalogue");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Bundle prices arrive as the text the admin typed and are read in one place,
 * `./pricing`, which is also what the builder shows them. An amount that
 * cannot be read stops the save and names the line, because the alternative
 * was `Math.round(undefined * 100)` writing NaN, or a blank field publishing
 * a line at R0.00 in a bundle a customer is about to buy.
 */
export async function saveBundleAction(input: {
  id?: string;
  name: string;
  slug: string;
  description?: string;
  /** The bundle price exactly as typed, for example "1 250,50". */
  price: string;
  featured: boolean;
  validUntil?: string;
  items: BundleItemDraft[];
}): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await upsertBundle(actor, {
      id: input.id,
      name: input.name,
      slug: input.slug,
      description: input.description || null,
      priceCents: requirePriceCents(input.price, "bundle price"),
      featured: input.featured,
      validUntil: input.validUntil || null,
      items: bundleItemsToInput(input.items),
    });
    revalidatePath("/admin/catalogue");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setBundleStatusAction(
  bundleId: string,
  status: "draft" | "published" | "archived"
): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await setBundleStatus(actor, bundleId, status);
    revalidatePath("/admin/catalogue");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const costRowSchema = z.object({
  kind: z.enum(["plan", "hardware"]),
  id: z.string().uuid(),
  /** Wholesale cost in cents, or null to clear it. */
  costCents: z.number().int().min(0).nullable(),
});

/**
 * Bulk wholesale cost capture. Every plan and SKU on one screen: filling in
 * 26 plans and 20 SKUs through the per-record sheet is 46 open, scroll,
 * type, save, wait cycles, and it is the last thing standing between the
 * catalogue and honest margin reporting.
 *
 * One transaction, one audit entry per changed record, one domain event.
 */
export async function saveCostPricesAction(
  form: FormData
): Promise<ActionResult & { saved?: number }> {
  try {
    const actor = await requireActor();
    authorize(actor, "catalogue.write");

    const updates: z.infer<typeof costRowSchema>[] = [];
    for (const [key, raw] of form.entries()) {
      const match = /^cost:(plan|hardware):(.+)$/.exec(key);
      if (!match) continue;
      const text = String(raw).trim();
      let costCents: number | null = null;
      if (text !== "") {
        try {
          costCents = parseZar(text);
        } catch {
          throw new Error(`"${text}" is not a valid amount, for example 249.00`);
        }
        if (costCents < 0) throw new Error("A cost price cannot be negative");
      }
      updates.push(
        costRowSchema.parse({
          kind: match[1] as "plan" | "hardware",
          id: match[2],
          costCents,
        })
      );
    }
    if (updates.length === 0) return { ok: true, saved: 0 };

    const changed = await db.transaction(async (tx) => {
      let count = 0;
      for (const update of updates) {
        if (update.kind === "plan") {
          const [before] = await tx
            .select({ costCents: plans.costCents, name: plans.name })
            .from(plans)
            .where(eq(plans.id, update.id))
            .limit(1);
          if (!before || before.costCents === update.costCents) continue;
          await tx
            .update(plans)
            .set({ costCents: update.costCents })
            .where(eq(plans.id, update.id));
          await writeAudit(tx, {
            actor,
            action: "plan.update",
            entity: "plan",
            entityId: update.id,
            before: { costCents: before.costCents },
            after: { costCents: update.costCents, via: "bulk cost prices" },
          });
        } else {
          const [before] = await tx
            .select({ costCents: hardwareProducts.costCents })
            .from(hardwareProducts)
            .where(eq(hardwareProducts.id, update.id))
            .limit(1);
          if (!before || before.costCents === update.costCents) continue;
          await tx
            .update(hardwareProducts)
            .set({ costCents: update.costCents })
            .where(eq(hardwareProducts.id, update.id));
          await writeAudit(tx, {
            actor,
            action: "hardware.update",
            entity: "hardware_product",
            entityId: update.id,
            before: { costCents: before.costCents },
            after: { costCents: update.costCents, via: "bulk cost prices" },
          });
        }
        count++;
      }
      if (count > 0) {
        await emitDomainEvent(tx, "catalogue.costs_updated", {
          changed: count,
          actorUserId: actor.userId,
        });
      }
      return count;
    });

    revalidatePath("/admin/catalogue");
    revalidatePath("/admin/reports");
    return { ok: true, saved: changed };
  } catch (err) {
    return fail(err);
  }
}
