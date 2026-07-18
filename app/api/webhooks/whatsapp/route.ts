import { NextRequest, NextResponse } from "next/server";
import { ingestWhatsAppMessage } from "@/lib/domain/inbox";

/**
 * Meta WhatsApp Cloud API webhook (spec §3, §8): GET verification handshake,
 * POST inbound messages into the unified inbox. Idempotent by message id.
 */

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

interface WaMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    entry?: {
      changes?: { value?: { messages?: WaMessage[] } }[];
    }[];
  } | null;
  if (!body?.entry) return new NextResponse("OK", { status: 200 });

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        try {
          await ingestWhatsAppMessage({
            fromPhone: message.from,
            externalId: message.id,
            body:
              message.type === "text"
                ? (message.text?.body ?? "")
                : `[${message.type} message]`,
            timestamp: message.timestamp
              ? Number(message.timestamp)
              : undefined,
          });
        } catch (err) {
          console.error("whatsapp ingest failed:", err);
        }
      }
    }
  }
  // Always 200 so Meta doesn't retry forever; failures are logged.
  return new NextResponse("OK", { status: 200 });
}
