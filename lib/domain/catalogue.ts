import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db/client";
import {
  plans,
  providers,
  hardwareProducts,
  bundles,
  bundleItems,
} from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";

/**
 * Catalogue domain (spec §4.2, §9.4.3). One catalogue, one truth: the public
 * site, signup wizard, quote builder and PDF catalogue all read from here.
 * Margin is always computed, never stored.
 */

// ---------------------------------------------------------------- queries

/**
 * Let a catalogue read fail the build softly, and only the build.
 *
 * Public pages are prerendered, so a database that is unreachable while Vercel
 * builds takes the whole deployment down: an unrelated hotfix cannot ship
 * because the catalogue was briefly unavailable. During the build a failed read
 * therefore degrades to an empty list, the page renders its honest empty state,
 * and ISR fills it in from the live database on the first request afterwards.
 *
 * At RUNTIME the error is rethrown, deliberately. An empty catalogue rendered
 * to a customer is a lie that looks like a working page, and with a one hour
 * revalidate it would keep lying long after the database came back. Far better
 * to show the branded error boundary and let the next request try again.
 */
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

async function catalogueRead<T>(what: string, run: () => Promise<T>, empty: T) {
  try {
    return await run();
  } catch (err) {
    if (!isBuild) throw err;
    console.error(
      `catalogue: could not read ${what} during the build, deferring to ISR:`,
      err
    );
    return empty;
  }
}

export type PlanWithProvider = typeof plans.$inferSelect & {
  provider: typeof providers.$inferSelect;
};

export async function publishedPlans(
  category?: (typeof plans.category.enumValues)[number]
): Promise<PlanWithProvider[]> {
  return catalogueRead("plans", async () => {
    const rows = await db
      .select()
      .from(plans)
      .innerJoin(providers, eq(plans.providerId, providers.id))
      .where(
        category
          ? and(eq(plans.status, "published"), eq(plans.category, category))
          : eq(plans.status, "published")
      )
      .orderBy(asc(plans.sortOrder), asc(plans.priceCents));
    return rows.map((r) => ({ ...r.plans, provider: r.providers }));
  }, []);
}

export async function publishedPlanBySlug(
  slug: string
): Promise<PlanWithProvider | null> {
  return catalogueRead("plan by slug", async () => {
    const rows = await db
      .select()
      .from(plans)
      .innerJoin(providers, eq(plans.providerId, providers.id))
      .where(and(eq(plans.slug, slug), eq(plans.status, "published")))
      .limit(1);
    if (!rows[0]) return null;
    return { ...rows[0].plans, provider: rows[0].providers };
  }, null);
}

export async function publishedHardware(
  category?: (typeof hardwareProducts.category.enumValues)[number]
) {
  return catalogueRead("hardware", () =>
    db
      .select()
      .from(hardwareProducts)
      .where(
        category
          ? and(
              eq(hardwareProducts.status, "published"),
              eq(hardwareProducts.category, category)
            )
          : eq(hardwareProducts.status, "published")
      )
      .orderBy(asc(hardwareProducts.sortOrder), asc(hardwareProducts.priceCents)),
  []);
}

export async function publishedHardwareBySku(sku: string) {
  return catalogueRead("hardware by sku", async () => {
    const rows = await db
      .select()
      .from(hardwareProducts)
      .where(
        and(eq(hardwareProducts.sku, sku), eq(hardwareProducts.status, "published"))
      )
      .limit(1);
    return rows[0] ?? null;
  }, null);
}

export type BundleWithItems = typeof bundles.$inferSelect & {
  items: (typeof bundleItems.$inferSelect & {
    plan?: typeof plans.$inferSelect | null;
    hardware?: typeof hardwareProducts.$inferSelect | null;
  })[];
};

export async function bundlesWithItems(opts: {
  publishedOnly: boolean;
}): Promise<BundleWithItems[]> {
  return catalogueRead("bundles", async () => {
  const bundleRows = await db
    .select()
    .from(bundles)
    .where(opts.publishedOnly ? eq(bundles.status, "published") : undefined)
    .orderBy(asc(bundles.name));
  if (bundleRows.length === 0) return [];
  const items = await db
    .select()
    .from(bundleItems)
    .where(
      inArray(
        bundleItems.bundleId,
        bundleRows.map((b) => b.id)
      )
    );
  const planIds = items.flatMap((i) => (i.planId ? [i.planId] : []));
  const hardwareIds = items.flatMap((i) => (i.hardwareId ? [i.hardwareId] : []));
  const planRows = planIds.length
    ? await db.select().from(plans).where(inArray(plans.id, planIds))
    : [];
  const hardwareRows = hardwareIds.length
    ? await db
        .select()
        .from(hardwareProducts)
        .where(inArray(hardwareProducts.id, hardwareIds))
    : [];
  return bundleRows.map((b) => ({
    ...b,
    items: items
      .filter((i) => i.bundleId === b.id)
      .map((i) => ({
        ...i,
        plan: i.planId ? planRows.find((p) => p.id === i.planId) : null,
        hardware: i.hardwareId
          ? hardwareRows.find((h) => h.id === i.hardwareId)
          : null,
      })),
  }));
  }, []);
}

export async function publishedBundleBySlug(
  slug: string
): Promise<BundleWithItems | null> {
  const all = await bundlesWithItems({ publishedOnly: true });
  return all.find((b) => b.slug === slug) ?? null;
}

/** Admin views: everything, all statuses. */
export async function allPlansWithProviders(): Promise<PlanWithProvider[]> {
  const rows = await db
    .select()
    .from(plans)
    .innerJoin(providers, eq(plans.providerId, providers.id))
    .orderBy(asc(plans.category), asc(plans.sortOrder));
  return rows.map((r) => ({ ...r.plans, provider: r.providers }));
}

export async function allHardware() {
  return db
    .select()
    .from(hardwareProducts)
    .orderBy(asc(hardwareProducts.category), asc(hardwareProducts.sortOrder));
}

export async function allProviders() {
  return db.select().from(providers).orderBy(asc(providers.name));
}

// -------------------------------------------------------------- mutations

const planInput = z.object({
  providerId: z.string().uuid(),
  category: z.enum(plans.category.enumValues),
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  description: z.string().max(2000).nullish(),
  speedDownMbps: z.number().int().positive().nullish(),
  speedUpMbps: z.number().int().positive().nullish(),
  dataAllocation: z.string().max(500).nullish(),
  fupDetail: z.string().max(2000).nullish(),
  contractMonths: z.number().int().positive().nullish(),
  priceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().nullish(),
  onceOffCents: z.number().int().nonnegative().default(0),
  onceOffCostCents: z.number().int().nonnegative().nullish(),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/** Public paths that render a plan; revalidated on publish-state changes. */
const CATEGORY_PATHS: Record<string, string> = {
  lte_home: "/internet",
  telkom_lte: "/internet",
  fibre: "/fibre",
  voip: "/voip",
  sim_data: "/sim-data",
};

function revalidateCatalogue(category?: string, slug?: string) {
  revalidateTag("catalogue", "max");
  revalidatePath("/", "page");
  if (category && CATEGORY_PATHS[category]) {
    revalidatePath(CATEGORY_PATHS[category], "page");
  }
  if (slug) revalidatePath(`/plans/${slug}`, "page");
  revalidatePath("/sitemap.xml");
}

export async function upsertPlan(
  actor: Actor,
  input: z.infer<typeof planInput> & { id?: string }
) {
  authorize(actor, "catalogue.write");
  const { id, ...raw } = input;
  const data = planInput.parse(raw);
  return db.transaction(async (tx) => {
    if (id) {
      const [before] = await tx.select().from(plans).where(eq(plans.id, id));
      if (!before) throw new Error("Plan not found");
      const [after] = await tx
        .update(plans)
        .set(data)
        .where(eq(plans.id, id))
        .returning();
      await writeAudit(tx, {
        actor,
        action: "catalogue.plan.update",
        entity: "plan",
        entityId: id,
        before,
        after,
      });
      if (after.status === "published") {
        revalidateCatalogue(after.category, after.slug);
      }
      return after;
    }
    const [created] = await tx
      .insert(plans)
      .values({ ...data, status: "draft" })
      .returning();
    await writeAudit(tx, {
      actor,
      action: "catalogue.plan.create",
      entity: "plan",
      entityId: created.id,
      after: created,
    });
    return created;
  });
}

export async function setPlanStatus(
  actor: Actor,
  planId: string,
  status: "draft" | "published" | "archived"
) {
  authorize(actor, "catalogue.publish");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(plans).where(eq(plans.id, planId));
    if (!before) throw new Error("Plan not found");
    const [after] = await tx
      .update(plans)
      .set({ status })
      .where(eq(plans.id, planId))
      .returning();
    await writeAudit(tx, {
      actor,
      action: `catalogue.plan.${status === "published" ? "publish" : status}`,
      entity: "plan",
      entityId: planId,
      before: { status: before.status },
      after: { status },
    });
    revalidateCatalogue(after.category, after.slug);
    return after;
  });
}

const hardwareInput = z.object({
  sku: z.string().min(2).max(60),
  name: z.string().min(2).max(160),
  category: z.enum(hardwareProducts.category.enumValues),
  description: z.string().max(2000).nullish(),
  specs: z.record(z.string(), z.unknown()).default({}),
  priceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().nullish(),
  stockQty: z.number().int().nonnegative().default(0),
  lowStockThreshold: z.number().int().nonnegative().default(3),
  imagePath: z.string().nullish(),
  sortOrder: z.number().int().default(0),
});

export async function upsertHardware(
  actor: Actor,
  input: z.infer<typeof hardwareInput> & { id?: string }
) {
  authorize(actor, "catalogue.write");
  const { id, ...raw } = input;
  const data = hardwareInput.parse(raw);
  return db.transaction(async (tx) => {
    if (id) {
      const [before] = await tx
        .select()
        .from(hardwareProducts)
        .where(eq(hardwareProducts.id, id));
      if (!before) throw new Error("Hardware not found");
      const [after] = await tx
        .update(hardwareProducts)
        .set(data)
        .where(eq(hardwareProducts.id, id))
        .returning();
      await writeAudit(tx, {
        actor,
        action: "catalogue.hardware.update",
        entity: "hardware",
        entityId: id,
        before,
        after,
      });
      if (after.status === "published") {
        revalidateTag("catalogue", "max");
        revalidatePath("/hardware", "page");
        revalidatePath(`/hardware/${after.sku}`, "page");
      }
      return after;
    }
    const [created] = await tx
      .insert(hardwareProducts)
      .values({ ...data, status: "draft" })
      .returning();
    await writeAudit(tx, {
      actor,
      action: "catalogue.hardware.create",
      entity: "hardware",
      entityId: created.id,
      after: created,
    });
    return created;
  });
}

export async function setHardwareStatus(
  actor: Actor,
  hardwareId: string,
  status: "draft" | "published" | "archived"
) {
  authorize(actor, "catalogue.publish");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(hardwareProducts)
      .where(eq(hardwareProducts.id, hardwareId));
    if (!before) throw new Error("Hardware not found");
    const [after] = await tx
      .update(hardwareProducts)
      .set({ status })
      .where(eq(hardwareProducts.id, hardwareId))
      .returning();
    await writeAudit(tx, {
      actor,
      action: `catalogue.hardware.${status === "published" ? "publish" : status}`,
      entity: "hardware",
      entityId: hardwareId,
      before: { status: before.status },
      after: { status },
    });
    revalidateTag("catalogue", "max");
    revalidatePath("/hardware", "page");
    revalidatePath(`/hardware/${after.sku}`, "page");
    return after;
  });
}

const bundleItemInput = z.object({
  itemType: z.enum(bundleItems.itemType.enumValues),
  planId: z.string().uuid().nullish(),
  hardwareId: z.string().uuid().nullish(),
  customName: z.string().max(160).nullish(),
  customPriceCents: z.number().int().nullish(),
  qty: z.number().int().positive().default(1),
});

const bundleInput = z.object({
  name: z.string().min(2).max(160),
  slug: z
    .string()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(2000).nullish(),
  priceCents: z.number().int().nonnegative(),
  featured: z.boolean().default(false),
  validUntil: z.string().date().nullish(),
  items: z.array(bundleItemInput).min(1),
});

export async function upsertBundle(
  actor: Actor,
  input: z.infer<typeof bundleInput> & { id?: string }
) {
  authorize(actor, "catalogue.write");
  const { id, ...raw } = input;
  const data = bundleInput.parse(raw);
  const { items, ...bundleData } = data;
  return db.transaction(async (tx) => {
    let bundleId = id;
    if (id) {
      const [before] = await tx.select().from(bundles).where(eq(bundles.id, id));
      if (!before) throw new Error("Bundle not found");
      await tx.update(bundles).set(bundleData).where(eq(bundles.id, id));
      await tx.delete(bundleItems).where(eq(bundleItems.bundleId, id));
      await writeAudit(tx, {
        actor,
        action: "catalogue.bundle.update",
        entity: "bundle",
        entityId: id,
        before,
        after: bundleData,
      });
    } else {
      const [created] = await tx
        .insert(bundles)
        .values({ ...bundleData, status: "draft" })
        .returning();
      bundleId = created.id;
      await writeAudit(tx, {
        actor,
        action: "catalogue.bundle.create",
        entity: "bundle",
        entityId: created.id,
        after: bundleData,
      });
    }
    await tx
      .insert(bundleItems)
      .values(items.map((i) => ({ ...i, bundleId: bundleId! })));
    revalidateTag("catalogue", "max");
    revalidatePath("/bundles", "page");
    return bundleId!;
  });
}

export async function setBundleStatus(
  actor: Actor,
  bundleId: string,
  status: "draft" | "published" | "archived"
) {
  authorize(actor, "catalogue.publish");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(bundles)
      .where(eq(bundles.id, bundleId));
    if (!before) throw new Error("Bundle not found");
    const [after] = await tx
      .update(bundles)
      .set({ status })
      .where(eq(bundles.id, bundleId))
      .returning();
    await writeAudit(tx, {
      actor,
      action: `catalogue.bundle.${status === "published" ? "publish" : status}`,
      entity: "bundle",
      entityId: bundleId,
      before: { status: before.status },
      after: { status },
    });
    revalidateTag("catalogue", "max");
    revalidatePath("/bundles", "page");
    revalidatePath(`/bundles/${after.slug}`, "page");
    revalidatePath("/", "page");
    return after;
  });
}
