import { serve } from "inngest/next";
import type { NextRequest } from "next/server";
import { inngest } from "@/inngest/client";
import { outboxDrain } from "@/inngest/functions/outbox";
import { abandonedSignups } from "@/inngest/functions/abandoned-signups";
import { billingRun } from "@/inngest/functions/billing";
import { appUrl } from "@/lib/config";
import { inngestConfig } from "@/lib/domain/ops-health";

/**
 * The endpoint Inngest syncs against and calls to run our functions.
 *
 * Why this used to answer {"code":"internal_server_error"} with nothing else:
 * `InngestCommHandler#handleAction` calls `checkModeConfiguration()` as its
 * very first statement, and that returns false whenever the client is in cloud
 * mode with no signing key. The handler then returns a hardcoded 500 body with
 * no explanation on the wire (the reason is logged, server side, where nobody
 * was looking). It is not a crash, it is a configuration check reported as a
 * crash, and it made a missing env var indistinguishable from a broken deploy.
 *
 * So the configuration check now happens here, before the SDK sees the
 * request, and says what is wrong in the response body. Once the keys are set
 * this guard is inert and every request goes straight through to the SDK
 * untouched.
 */

/**
 * Registering behind the custom domain.
 *
 * Left to itself the SDK builds the URL it registers from the incoming
 * request, which on Vercel can be the per-deployment `*.vercel.app` host
 * rather than www.needdconnect.co.za. Inngest would then keep calling a URL
 * that changes on every deploy. Pinning the origin and path to our own
 * canonical origin makes the registered URL stable and correct.
 *
 * `appUrl()` throws when APP_URL is absent and no Vercel URL is injected. That
 * must not be able to take this endpoint down, since an endpoint that throws is
 * precisely the failure this file is fixing, so the throw degrades to the
 * SDK's own inference.
 */
function serveOrigin(): string | undefined {
  try {
    return appUrl();
  } catch (err) {
    console.error(
      "inngest serve: could not resolve the app origin, falling back to request inference:",
      err
    );
    return undefined;
  }
}

const handlers = serve({
  client: inngest,
  functions: [outboxDrain, abandonedSignups, billingRun],
  serveOrigin: serveOrigin(),
  servePath: "/api/inngest",
});

/**
 * The honest answer when the deployment has no keys.
 *
 * 503 rather than 500: nothing is broken, the endpoint simply has not been
 * given what it needs, and that is a different thing for whoever is reading
 * the status page. no-store because the answer changes the moment the env vars
 * are set and a cached "not configured" would outlive the fix.
 */
function notConfigured(): Response {
  const config = inngestConfig();
  return Response.json(
    {
      code: "inngest_not_configured",
      message:
        "This deployment has no Inngest keys, so the scheduled jobs (nightly billing, outbox drain, abandoned signup capture) are not running. Set the variables below in the Vercel project and redeploy.",
      missing: config.missing,
      mode: config.mode,
      where: "https://app.inngest.com, Manage, Event keys and Signing key",
      serveUrl: `${serveOrigin() ?? ""}/api/inngest`,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(req: NextRequest, ctx: unknown): Promise<Response> {
  if (!inngestConfig().ready) return notConfigured();
  return handlers.GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: unknown): Promise<Response> {
  if (!inngestConfig().ready) return notConfigured();
  return handlers.POST(req, ctx);
}

export async function PUT(req: NextRequest, ctx: unknown): Promise<Response> {
  if (!inngestConfig().ready) return notConfigured();
  return handlers.PUT(req, ctx);
}
