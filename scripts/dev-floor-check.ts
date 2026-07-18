/** Dev check: the §10.4 discount floor rejects a rep's too-deep discount. */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import Module from "node:module";
import path from "node:path";
const m = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string };
const orig = m._resolveFilename;
const noop = path.join(__dirname, "noop.js");
m._resolveFilename = function (r: string, ...a: unknown[]) {
  return r === "server-only" ? noop : orig.call(this, r, ...a);
};
async function main() {
  const { db } = await import("../lib/db/client");
  const schema = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { createQuote, DiscountFloorError } = await import("../lib/domain/quotes");
  const [rep] = await db.select().from(schema.users).where(eq(schema.users.role, "sales")).limit(1);
  const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.slug, "voip-basic")).limit(1);
  try {
    await createQuote({ userId: rep.id, role: "sales" }, {
      items: [{ itemType: "plan", planId: plan.id, discountCents: 20000, qty: 1 }],
    });
    console.log("FAIL: floor did not block");
    process.exit(1);
  } catch (err) {
    if (err instanceof DiscountFloorError) {
      console.log("OK floor blocked rep:", err.message);
    } else throw err;
  }
  // Admin can go below the floor.
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
  const result = await createQuote({ userId: admin.id, role: "admin" }, {
    items: [{ itemType: "plan", planId: plan.id, discountCents: 20000, qty: 1 }],
  });
  console.log("OK admin override created", result.number);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
