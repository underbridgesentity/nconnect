"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { requireActor } from "@/lib/auth";
import {
  upsertPlan,
  setPlanStatus,
  upsertHardware,
  setHardwareStatus,
  upsertBundle,
  setBundleStatus,
} from "@/lib/domain/catalogue";
import { uploadFile, randomFileName } from "@/lib/storage";

export type ActionResult = { ok: boolean; error?: string };

function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : "Failed" };
}

function num(form: FormData, key: string): number {
  const v = String(form.get(key) ?? "").trim();
  return v === "" ? 0 : Math.round(Number(v) * 100);
}

function optNum(form: FormData, key: string): number | null {
  const v = String(form.get(key) ?? "").trim();
  if (v === "") return null;
  return Math.round(Number(v) * 100);
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

export type BundleItemDraft = {
  itemType: "plan" | "hardware" | "custom";
  planId?: string;
  hardwareId?: string;
  customName?: string;
  customPriceRands?: number;
  qty: number;
};

export async function saveBundleAction(input: {
  id?: string;
  name: string;
  slug: string;
  description?: string;
  priceRands: number;
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
      priceCents: Math.round(input.priceRands * 100),
      featured: input.featured,
      validUntil: input.validUntil || null,
      items: input.items.map((i) => ({
        itemType: i.itemType,
        planId: i.planId || null,
        hardwareId: i.hardwareId || null,
        customName: i.customName || null,
        customPriceCents:
          i.customPriceRands != null ? Math.round(i.customPriceRands * 100) : null,
        qty: i.qty,
      })),
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
