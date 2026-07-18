/**
 * Dev utility: renders the published catalogue PDF to disk without needing
 * an admin session. Usage: pnpm tsx scripts/render-catalogue.tsx [outfile]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// The lib modules guard with `import "server-only"`; alias it to a no-op for
// this out-of-band script (never bundled client-side).
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

async function main() {
  const { renderCataloguePdf } = await import("../lib/pdf/catalogue");
  const { writeFileSync } = await import("node:fs");
  const out = process.argv[2] ?? "catalogue-preview.pdf";
  const pdf = await renderCataloguePdf();
  writeFileSync(out, pdf);
  console.log(`Wrote ${out} (${pdf.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
