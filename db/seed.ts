/**
 * Idempotent seed (spec §14). Run: pnpm seed  (dev extras: pnpm seed --dev)
 *
 * All catalogue records seed as `published` unless noted. cost_cents is null
 * everywhere by design: the client fills wholesale costs in the Catalogue UI
 * (missing-cost badge + Reports checklist exist for exactly this).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { hash as argon2Hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import * as schema from "../lib/db/schema";
import { rands } from "../lib/money";

const {
  providers,
  plans,
  hardwareProducts,
  bundles,
  bundleItems,
  settings,
  users,
  customers,
} = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const client = postgres(connectionString, { prepare: false });
const db = drizzle(client, { schema });

const isDev = process.argv.includes("--dev");

async function upsertProvider(
  name: string,
  kind: "mno" | "fno" | "voip"
): Promise<string> {
  const existing = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.name, name))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db
    .insert(providers)
    .values({ name, kind })
    .returning({ id: providers.id });
  return row.id;
}

type PlanSeed = Omit<typeof plans.$inferInsert, "id" | "providerId"> & {
  providerName: string;
};

async function upsertPlan(providerIds: Record<string, string>, p: PlanSeed) {
  const { providerName, ...rest } = p;
  const values = { ...rest, providerId: providerIds[providerName] };
  const existing = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.slug, p.slug))
    .limit(1);
  if (existing[0]) {
    await db.update(plans).set(values).where(eq(plans.id, existing[0].id));
  } else {
    await db.insert(plans).values(values);
  }
}

async function upsertHardware(h: typeof hardwareProducts.$inferInsert) {
  const existing = await db
    .select({ id: hardwareProducts.id })
    .from(hardwareProducts)
    .where(eq(hardwareProducts.sku, h.sku))
    .limit(1);
  if (existing[0]) {
    // Never clobber client-managed stock levels on re-seed.
    const rest = { ...h };
    delete rest.stockQty;
    await db
      .update(hardwareProducts)
      .set(rest)
      .where(eq(hardwareProducts.id, existing[0].id));
  } else {
    await db.insert(hardwareProducts).values(h);
  }
}

async function setSettingIfMissing(key: string, value: unknown) {
  const existing = await db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  if (!existing[0]) {
    await db.insert(settings).values({ key, value });
  }
}

async function main() {
  console.log("Seeding Needd Connect…");

  // ---------------------------------------------------------------- providers
  const providerNames: [string, "mno" | "fno" | "voip"][] = [
    ["MTN", "mno"],
    ["Vodacom", "mno"],
    ["Telkom", "mno"],
    ["Openserve", "fno"],
    ["Vumatel", "fno"],
    ["Frogfoot", "fno"],
    ["MetroFibre", "fno"],
    ["Needd Voice", "voip"],
  ];
  const providerIds: Record<string, string> = {};
  for (const [name, kind] of providerNames) {
    providerIds[name] = await upsertProvider(name, kind);
  }

  // ---------------------------------------------------- MTN/Vodacom LTE/5G
  // Catalogue note: seeded against MTN; the network metadata records the
  // MTN/Vodacom dual offer as printed in the May 2026 catalogue.
  const lteMeta = {
    network: "MTN / Vodacom",
    routerNote: "Network-approved router required",
    contracts: "No contracts",
    activation: "Instant activation",
  };
  const lteHome: [string, number, string, string][] = [
    ["Starter", 388, "150GB @ full speed, then 512Kbps", "512Kbps"],
    ["Plus", 521, "300GB @ full speed, then 512Kbps", "512Kbps"],
    ["Advanced", 632, "450GB @ full speed, then 1Mbps", "1Mbps"],
    ["Max", 743, "600GB @ full speed, then 2Mbps", "2Mbps"],
    ["Max+", 1077, "1000GB @ full speed, then 2Mbps", "2Mbps"],
  ];
  for (const [i, [name, price, allocation, fupSpeed]] of lteHome.entries()) {
    await upsertPlan(providerIds, {
      providerName: "MTN",
      category: "lte_home",
      name: `Uncapped LTE/5G ${name}`,
      slug: `lte-home-${name.toLowerCase().replace("+", "-plus")}`,
      description:
        "Uncapped MTN/Vodacom LTE or 5G home internet. No fixed line required, plug in the router and you're online.",
      dataAllocation: allocation,
      fupDetail: `After the full-speed allocation, speed continues uncapped at ${fupSpeed}.`,
      priceCents: rands(price),
      costCents: null,
      onceOffCents: rands(1833),
      status: "published",
      featured: name === "Plus",
      sortOrder: i,
      metadata: lteMeta,
    });
  }

  // -------------------------------------------------------- Telkom LTE
  const telkomLte: [string, number, number, string][] = [
    ["Starter", 10, 331, "100GB @ 10Mbps, then 20GB @ 4Mbps, then unlimited @ 2Mbps"],
    ["Plus", 20, 654, "500GB @ 20Mbps, then 50GB @ 4Mbps, then unlimited @ 2Mbps"],
    ["Advanced", 30, 754, "500GB @ 20Mbps, then 50GB @ 4Mbps, then unlimited @ 2Mbps"],
  ];
  for (const [i, [name, speed, price, allocation]] of telkomLte.entries()) {
    await upsertPlan(providerIds, {
      providerName: "Telkom",
      category: "telkom_lte",
      name: `Telkom Uncapped LTE ${name}`,
      slug: `telkom-lte-${name.toLowerCase()}`,
      description:
        "Telkom uncapped LTE. Use any LTE-compatible device, no geo-locking, no contracts.",
      speedDownMbps: speed,
      dataAllocation: allocation,
      fupDetail:
        "Speeds step down after each allocation and continue unlimited at 2Mbps.",
      priceCents: rands(price),
      costCents: null,
      onceOffCents: rands(640),
      status: "published",
      sortOrder: i,
      metadata: {
        network: "Telkom",
        deviceNote: "Use any LTE-compatible device",
        geoLocking: "None",
        contracts: "No contracts",
      },
    });
  }

  // ------------------------------------------------------------- Fibre
  // Once-off seeded R0; client confirms installation/activation fees before
  // publish (spec §14), flagged in PROGRESS.md and the launch checklist.
  const fibre: [string, string, number, number, number][] = [
    ["Openserve", "openserve-30-50", 30, 50, 533],
    ["Openserve", "openserve-100-100", 100, 100, 1072],
    ["Vumatel", "vumatel-30-50", 30, 50, 533],
    ["Vumatel", "vumatel-100-100", 100, 100, 1104],
    ["Frogfoot", "frogfoot-60-60", 60, 60, 839],
    ["Frogfoot", "frogfoot-120-120", 120, 120, 978],
    ["MetroFibre", "metrofibre-nova-20-20", 20, 20, 572],
    ["MetroFibre", "metrofibre-nexus-25-25", 25, 25, 650],
  ];
  for (const [i, [fno, slug, down, up, price]] of fibre.entries()) {
    const nameSuffix =
      slug.includes("nova") ? "Nova " : slug.includes("nexus") ? "Nexus " : "";
    await upsertPlan(providerIds, {
      providerName: fno,
      category: "fibre",
      name: `${fno} ${nameSuffix}${down}/${up} Mbps`,
      slug: `fibre-${slug}`,
      description:
        "Uncapped, unshaped fibre. Seamless streaming, gaming and browsing.",
      speedDownMbps: down,
      speedUpMbps: up,
      dataAllocation: "Uncapped, unshaped",
      fupDetail: "No fair-use throttling. Speeds as stated, up/down as indicated.",
      priceCents: rands(price),
      costCents: null,
      onceOffCents: 0,
      status: "published",
      sortOrder: i,
      metadata: { fno },
    });
  }

  // -------------------------------------------------------------- VoIP
  const voipMeta = {
    callRates: {
      localMobilePerMin: 69, // cents
      telkomLandlinePerMin: 26,
      internationalUsaUkPerMin: 27,
    },
    billing: "Per-second billing",
    rollover: "3-month call time rollover",
    porting: "Keep your existing geographic number",
  };
  const voip: [string, number, number][] = [
    ["Basic", 5, 382],
    ["Regular", 10, 706],
    ["Classic", 15, 971],
    ["Deluxe", 20, 1176],
  ];
  for (const [i, [name, extensions, price]] of voip.entries()) {
    await upsertPlan(providerIds, {
      providerName: "Needd Voice",
      category: "voip",
      name: `Business VoIP ${name}`,
      slug: `voip-${name.toLowerCase()}`,
      description: `Up to ${extensions} extensions with call recording, IVR management, call management and virtual assistants.`,
      dataAllocation: `Up to ${extensions} extensions`,
      fupDetail:
        "Calls billed per second at the published rates. Number porting supported.",
      priceCents: rands(price),
      costCents: null,
      onceOffCents: rands(price),
      status: "published",
      sortOrder: i,
      metadata: { ...voipMeta, extensions },
    });
  }

  // ---------------------------------------------------- SIM data (Telkom)
  const simData: [string, string, number][] = [
    ["40GB (20 + 20)", "40gb", 232],
    ["80GB (40 + 40)", "80gb", 339],
    ["160GB (80 + 80)", "160gb", 372],
    ["240GB (120 + 120)", "240gb", 433],
    ["360GB (180 + 180)", "360gb", 544],
    ["2TB", "2tb", 950],
  ];
  for (const [i, [name, slug, price]] of simData.entries()) {
    await upsertPlan(providerIds, {
      providerName: "Telkom",
      category: "sim_data",
      name: `Telkom LTE Fixed ${name}`,
      slug: `sim-data-telkom-${slug}`,
      description:
        "SIM-only capped LTE data on a 24-month subscription. Data split equally between day and night bundles. Router sold separately.",
      dataAllocation: name.includes("2TB")
        ? "2TB on a 24-month contract"
        : `${name}, day and night split`,
      fupDetail: "Capped data; no throttling. Unused data per bundle rules.",
      contractMonths: 24,
      priceCents: rands(price),
      costCents: null,
      onceOffCents: rands(price), // once-off equals first month per catalogue
      status: "published",
      sortOrder: i,
      metadata: { network: "Telkom", simOnly: true, term: "24 months" },
    });
  }

  // ----------------------------------------------------------- Hardware
  type HW = [string, string, (typeof hardwareProducts.$inferInsert)["category"], number, string];
  const hardware: HW[] = [
    ["RTR-ZTE-MF935", "ZTE MF935 LTE Mobile MiFi", "router_lte", 710, "WiFi 802.11n, 4G, up to 8 devices"],
    ["RTR-TPL-MR600", "TP-Link Archer MR600 4G+ Router", "router_lte", 1777, "WiFi 2.4 & 5GHz, up to 64 devices"],
    ["RTR-CD-LT500", "Cudy LT500 4G LTE Router", "router_lte", 640, "WiFi 5, DL up to 2.8Gbps, up to 64 devices"],
    ["RTR-CD-LT500-OUT", "Cudy LT500 Outdoor 4G LTE", "router_lte", 1056, "WiFi 5, outdoor, up to 64 devices"],
    ["RTR-CD-LT700", "Cudy LT700 4G LTE Dual SIM", "router_lte", 1439, "WiFi 5, dual SIM, up to 64 devices"],
    ["RTR-ZTE-G5TS", "ZTE G5TS 5G Router WiFi 6 (MTN FWA approved)", "router_5g", 1833, "WiFi 6, DL up to 2.8Gbps, up to 64 devices"],
    ["RTR-HW-AX3", "Huawei AX3 WS7100", "router_fibre", 655, "WiFi 2.4 & 5GHz, up to 128 devices"],
    ["RTR-CD-GP1200", "Cudy GP1200 WiFi 5 xPON Router", "router_fibre", 417, "WiFi 2.4 & 5GHz, up to 128 devices"],
    ["RTR-CD-GP3000", "Cudy GP3000 WiFi 6 xPON Router", "router_fibre", 550, "WiFi 2.4 & 5GHz, up to 128 devices"],
    ["MSH-CD-M1200-2", "Cudy M1200 Mesh (2-pack)", "mesh", 611, "WiFi 2.4 & 5GHz, up to 100 devices per unit"],
    ["MSH-CD-M1200-3", "Cudy M1200 Mesh (3-pack)", "mesh", 917, "WiFi 2.4 & 5GHz, up to 100 devices per unit"],
    ["EXT-CD-RE1200", "Cudy RE1200 Range Extender", "extender", 306, "WiFi 2.4 & 5GHz, range extender / AP mode"],
    ["EXT-CD-RE3000", "Cudy RE3000 WiFi 6 Extender", "extender", 478, "WiFi 6, Gigabit Ethernet, mesh compatible"],
    ["EXT-CD-RE3600", "Cudy RE3600 WiFi 7 Extender", "extender", 772, "WiFi 7, 3600Mbps aggregate, 2x ext + 2x int antennas"],
    ["VOIP-YL-AX83H", "Yealink AX83H Portable IP Phone", "voip_phone", 1903, "HD Voice, up to 10 SIP accounts, built-in WiFi, charger included"],
    ["VOIP-YL-W73P", "Yealink W73P DECT Phone + Base", "voip_phone", 1903, "HD Voice, includes DP752 DECT base station (W70B + W73H)"],
    ["VOIP-YL-T31W", "Yealink T31W Desktop IP Phone", "voip_phone", 1057, "2-line carrier desk phone, HD Voice, built-in WiFi, PSU included"],
    ["PWR-NT-UPS100", "Netogy UPS100 Plus Mini DC UPS", "power", 666, "Router back-up power / powerbank"],
    ["ACC-NT-NOVA10", "Netogy Nova10 Android TV Box", "accessory", 943, "Turns non-smart TVs into smart TVs"],
    ["ACC-NT-NOVA10-RC", "Netogy Nova10 Remote", "accessory", 144, "Bluetooth remote control only"],
  ];
  for (const [i, [sku, name, category, price, blurb]] of hardware.entries()) {
    await upsertHardware({
      sku,
      name,
      category,
      description: blurb,
      specs: { keyFeatures: blurb },
      priceCents: rands(price),
      costCents: null,
      stockQty: 0,
      lowStockThreshold: 3,
      status: "published",
      sortOrder: i,
    });
  }

  // ----------------------------------------------- Bundle (draft example)
  const existingBundle = await db
    .select({ id: bundles.id })
    .from(bundles)
    .where(eq(bundles.slug, "telkom-lte-plus-cudy-lt500"))
    .limit(1);
  if (!existingBundle[0]) {
    const [telkomPlus] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.slug, "telkom-lte-plus"))
      .limit(1);
    const [lt500] = await db
      .select({ id: hardwareProducts.id })
      .from(hardwareProducts)
      .where(eq(hardwareProducts.sku, "RTR-CD-LT500"))
      .limit(1);
    const [bundle] = await db
      .insert(bundles)
      .values({
        name: "Telkom LTE Plus + Cudy LT500",
        slug: "telkom-lte-plus-cudy-lt500",
        description:
          "Telkom Uncapped LTE Plus with the Cudy LT500 router and free delivery.",
        priceCents: rands(654 + 640),
        status: "draft",
      })
      .returning({ id: bundles.id });
    await db.insert(bundleItems).values([
      { bundleId: bundle.id, itemType: "plan", planId: telkomPlus.id, qty: 1 },
      { bundleId: bundle.id, itemType: "hardware", hardwareId: lt500.id, qty: 1 },
      {
        bundleId: bundle.id,
        itemType: "custom",
        customName: "Free delivery",
        customPriceCents: 0,
        qty: 1,
      },
    ]);
  }

  // ------------------------------------------------------------ Settings
  await setSettingIfMissing("dunning", {
    chargeAttemptDays: [0, 2, 5],
    pastDueDay: 7,
    suspendDay: 10,
    adminDecisionDay: 40,
    invoiceDueDays: 7,
  });
  await setSettingIfMissing("suspension_grace_days", 3);
  await setSettingIfMissing("min_margin_floor_percent", 10);
  await setSettingIfMissing("no_cost_max_discount_percent", 15);
  await setSettingIfMissing("quote_validity_days", 14);
  await setSettingIfMissing("commission_percent", 10);
  await setSettingIfMissing("reactivation_fee_cents", 0);
  await setSettingIfMissing("company", {
    legalName: "Needd Technology Solutions (Pty) Ltd",
    website: "www.needd.co.za",
    phone: "086 686 3078",
    email: "info@needd.co.za",
    vat: "4290292087",
    reg: "2014/063733/07",
    bbbee: "B-BBEE Level 1",
  });
  await setSettingIfMissing("banking", {
    bank: "TBC",
    accountName: "Needd Technology Solutions (Pty) Ltd",
    accountNumber: "TBC, client to provide before launch",
    branchCode: "TBC",
    reference: "Your invoice number",
  });

  // --------------------------------------------------------------- Users
  const adminEmail = "admin@needdconnect.co.za";
  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);
  if (!existingAdmin) {
    if (isDev) {
      const password = randomBytes(9).toString("base64url");
      await db.insert(users).values({
        role: "admin",
        email: adminEmail,
        name: "Needd Admin",
        status: "active",
        passwordHash: await argon2Hash(password),
      });
      console.log(`\n  DEV admin login: ${adminEmail} / ${password}\n`);
    } else {
      await db.insert(users).values({
        role: "admin",
        email: adminEmail,
        name: "Needd Admin",
        status: "invited",
      });
      console.log(
        `  Admin ${adminEmail} seeded as invited, send the setup link from Staff management.`
      );
    }
  }

  if (isDev) {
    const salesEmail = "rep@needdconnect.co.za";
    const [existingRep] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, salesEmail))
      .limit(1);
    let repId = existingRep?.id;
    if (!repId) {
      const password = randomBytes(9).toString("base64url");
      const [rep] = await db
        .insert(users)
        .values({
          role: "sales",
          email: salesEmail,
          name: "Demo Rep",
          status: "active",
          passwordHash: await argon2Hash(password),
        })
        .returning({ id: users.id });
      repId = rep.id;
      console.log(`  DEV sales login: ${salesEmail} / ${password}\n`);
    }

    const demoPhone = "+27820000001";
    const [existingCustomerUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, demoPhone))
      .limit(1);
    if (!existingCustomerUser) {
      const [custUser] = await db
        .insert(users)
        .values({
          role: "customer",
          phone: demoPhone,
          name: "Thandi Demo",
          status: "active",
        })
        .returning({ id: users.id });
      await db.insert(customers).values({
        userId: custUser.id,
        type: "individual",
        firstName: "Thandi",
        lastName: "Demo",
        phone: demoPhone,
        email: "thandi.demo@example.com",
        source: "web",
        assignedSalesId: repId,
      });
      console.log(`  DEV customer: OTP login with ${demoPhone} (code prints to console)\n`);
    }
  }

  console.log("Seed complete.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
