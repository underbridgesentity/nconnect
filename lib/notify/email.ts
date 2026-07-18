import "server-only";
import { Resend } from "resend";

/**
 * Outbound transactional email via Resend. Without an API key (dev) the
 * message is logged to the console so no flow silently drops mail.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Buffer }[];
}

export async function sendEmail(
  msg: EmailMessage
): Promise<{ ok: boolean; detail?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "hello@needdconnect.co.za";

  if (!apiKey) {
    console.log(
      `[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${
        msg.text ?? msg.html
      }`
    );
    return { ok: true };
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  if (error) return { ok: false, detail: error.message };
  return { ok: true };
}
