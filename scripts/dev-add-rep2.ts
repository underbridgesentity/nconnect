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
  const { hash } = await import("@node-rs/argon2");
  const email = "rep2@needdconnect.co.za";
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) { console.log("exists"); process.exit(0); }
  await db.insert(schema.users).values({
    role: "sales", email, name: "Second Rep", status: "active",
    passwordHash: await hash("rep2-test-password"),
  });
  console.log("rep2 created: rep2@needdconnect.co.za / rep2-test-password");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
