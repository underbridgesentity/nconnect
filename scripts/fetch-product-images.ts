/**
 * Dev utility: source manufacturer product images for hardware SKUs.
 * For each SKU we fetch the vendor product page, read its og:image, validate
 * (real image, >=500px wide), convert to a padded square webp and load it
 * through the SAME storage path the admin uploader uses, then set
 * hardware_products.image_path. SKUs without a clean hit keep the honest
 * placeholder.
 *
 * Usage: DATABASE_URL=... [SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...] \
 *        pnpm tsx scripts/fetch-product-images.ts
 */
import { config as loadEnv } from "dotenv";
if (!process.env.DATABASE_URL) loadEnv({ path: [".env.local", ".env"] });
import Module from "node:module";
import path from "node:path";
const moduleAny = Module as unknown as {
  _resolveFilename: (request: string, ...args: unknown[]) => string;
};
const origResolve = moduleAny._resolveFilename;
const noop = path.join(__dirname, "noop.js");
moduleAny._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return noop;
  return origResolve.call(this, request, ...args);
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Vendor product pages per SKU (manufacturer press imagery via og:image). */
const SOURCES: Record<string, string[]> = {
  "RTR-CD-LT500": ["https://www.cudy.com/products/lt500-2-0", "https://www.cudy.com/products/lt500-1-0"],
  "RTR-CD-LT500-OUT": ["https://www.cudy.com/products/lt500-outdoor-1-0"],
  "RTR-CD-LT700": ["https://www.cudy.com/products/lt700-1-0"],
  "RTR-CD-GP1200": ["https://www.cudy.com/products/gp1200-1-0"],
  "RTR-CD-GP3000": ["https://www.cudy.com/products/gp3000-1-0"],
  "MSH-CD-M1200-2": ["https://www.cudy.com/products/m1200-1-0"],
  "MSH-CD-M1200-3": ["https://www.cudy.com/products/m1200-1-0"],
  "EXT-CD-RE1200": ["https://www.cudy.com/products/re1200-1-0"],
  "EXT-CD-RE3000": ["https://www.cudy.com/products/re3000-1-0"],
  "EXT-CD-RE3600": ["https://www.cudy.com/products/re3600-1-0"],
  "RTR-TPL-MR600": [
    "https://www.tp-link.com/za/home-networking/mifi/archer-mr600/",
    "https://www.tp-link.com/en/home-networking/mifi/archer-mr600/",
  ],
  "VOIP-YL-T31W": [
    "https://www.yealink.com/en/product-detail/ip-phone-t31w",
  ],
  "VOIP-YL-AX83H": [
    "https://www.yealink.com/en/product-detail/ip-phone-ax83h",
  ],
  "VOIP-YL-W73P": [
    "https://www.yealink.com/en/product-detail/dect-phone-w73p",
  ],
  "RTR-HW-AX3": [
    "https://consumer.huawei.com/en/routers/ax3/",
    "https://consumer.huawei.com/za/routers/ax3/",
  ],
};

async function fetchOgImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!match) return null;
    let url = match[1].replace(/&amp;/g, "&");
    if (url.startsWith("//")) url = "https:" + url;
    if (url.startsWith("/")) url = new URL(url, pageUrl).toString();
    return url;
  } catch {
    return null;
  }
}

async function main() {
  const sharp = (await import("sharp")).default;
  const { db } = await import("../lib/db/client");
  const { hardwareProducts } = await import("../lib/db/schema");
  const { uploadFile } = await import("../lib/storage");
  const { eq } = await import("drizzle-orm");

  let done = 0;
  let skipped = 0;
  for (const [sku, pages] of Object.entries(SOURCES)) {
    let stored = false;
    for (const page of pages) {
      const imageUrl = await fetchOgImage(page);
      if (!imageUrl) continue;
      try {
        const res = await fetch(imageUrl, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) continue;
        const input = Buffer.from(await res.arrayBuffer());
        const probe = sharp(input);
        const meta = await probe.metadata();
        if (!meta.width || meta.width < 500) continue;
        // Padded square on white, consistent card presentation.
        const webp = await sharp(input)
          .flatten({ background: "#ffffff" })
          .resize(1200, 1200, { fit: "contain", background: "#ffffff" })
          .webp({ quality: 86 })
          .toBuffer();
        const filePath = `hardware/${sku.toLowerCase()}.webp`;
        await uploadFile("catalogue", filePath, webp, "image/webp");
        await db
          .update(hardwareProducts)
          .set({ imagePath: filePath })
          .where(eq(hardwareProducts.sku, sku));
        console.log(`OK   ${sku}  <- ${page}`);
        stored = true;
        done++;
        break;
      } catch {
        continue;
      }
    }
    if (!stored) {
      console.log(`SKIP ${sku} (no clean manufacturer image found)`);
      skipped++;
    }
  }
  console.log(`\n${done} stored, ${skipped} left on placeholder`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
