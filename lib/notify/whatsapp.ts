import "server-only";

/**
 * Meta WhatsApp Cloud API sender.
 *
 * WhatsApp is a later addition, not the backbone. Email carries every customer
 * notification; WhatsApp is an extra copy that only goes out when BOTH gates
 * are open:
 *   1. WHATSAPP_ENABLED === "true" (the platform switch), and
 *   2. the customer opted in (the per-customer switch, off by default).
 *
 * Both gates matter. Flipping the env var on later must not silently redirect
 * anyone's notifications away from email, which is why `whatsappRecipient`
 * below refuses to return a number without an explicit opt-in.
 */

export function whatsappEnabled(): boolean {
  return process.env.WHATSAPP_ENABLED === "true";
}

/**
 * The bits of a customer row this module needs.
 *
 * `whatsappOptIn` is optional because the column does not exist yet: WhatsApp
 * is a later stage, and until the opt-in is stored and collectable the field
 * reads as undefined, which means "not opted in" and therefore email only.
 * When the column lands, the value flows through here with no further change.
 */
export interface WhatsAppRecipient {
  phone: string | null;
  whatsappOptIn?: boolean | null;
}

/**
 * The number to send a WhatsApp copy to, or null when WhatsApp must stay out
 * of it. Null is the normal answer today.
 */
export function whatsappRecipient(
  customer: WhatsAppRecipient
): string | null {
  if (!whatsappEnabled()) return null;
  if (customer.whatsappOptIn !== true) return null;
  return customer.phone ?? null;
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
