import "server-only";

/**
 * Meta WhatsApp Cloud API sender. Env-gated: when WHATSAPP_ENABLED !== "true"
 * callers (the dispatcher, OTP service) fall back to email/SMS so no event is
 * silent while Meta verification is pending (spec §3, §8).
 */

export function whatsappEnabled(): boolean {
  return process.env.WHATSAPP_ENABLED === "true";
}

export interface TemplateSend {
  to: string; // E.164 without +
  template: string;
  languageCode?: string;
  bodyParams?: string[];
}

export async function sendWhatsAppTemplate(
  msg: TemplateSend
): Promise<{ ok: boolean; detail?: string; externalId?: string }> {
  if (!whatsappEnabled()) {
    return { ok: false, detail: "whatsapp disabled" };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { ok: false, detail: "whatsapp credentials missing" };
  }
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: msg.template,
          language: { code: msg.languageCode ?? "en" },
          components: msg.bodyParams?.length
            ? [
                {
                  type: "body",
                  parameters: msg.bodyParams.map((p) => ({
                    type: "text",
                    text: p,
                  })),
                },
              ]
            : undefined,
        },
      }),
    }
  );
  if (!res.ok) {
    return { ok: false, detail: `whatsapp ${res.status}: ${await res.text()}` };
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return { ok: true, externalId: data.messages?.[0]?.id };
}

/** Free-form session message (24h window), used for inbox replies. */
export async function sendWhatsAppText(
  to: string,
  body: string
): Promise<{ ok: boolean; detail?: string; externalId?: string }> {
  if (!whatsappEnabled()) return { ok: false, detail: "whatsapp disabled" };
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { ok: false, detail: "whatsapp credentials missing" };
  }
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { body },
      }),
    }
  );
  if (!res.ok) {
    return { ok: false, detail: `whatsapp ${res.status}: ${await res.text()}` };
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return { ok: true, externalId: data.messages?.[0]?.id };
}
