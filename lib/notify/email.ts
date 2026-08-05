import "server-only";
import { Resend } from "resend";

/**
 * Outbound transactional email via Resend.
 *
 * The console fallback exists for development only. Outside production (or
 * when EMAIL_DRIVER=console is set explicitly) a missing API key logs the
 * message and reports success, so local flows keep moving. In production a
 * missing key is a real failure and is reported as one: pretending the mail
 * went out would tell a customer their sign-in code was sent while it was
 * actually written to the platform logs, which is the worst of both worlds.
 * The production failure path never logs the body; sign-in codes and invoice
 * contents have no business in a log stream.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Buffer }[];
}

function consoleDriverAllowed(): boolean {
  if (process.env.EMAIL_DRIVER === "console") return true;
  return process.env.NODE_ENV !== "production";
}

export async function sendEmail(
  msg: EmailMessage
): Promise<{ ok: boolean; detail?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "hello@needdconnect.co.za";

  if (!apiKey) {
    if (consoleDriverAllowed()) {
      // Dev convenience: the body is logged so a local sign-in can read its
      // code off the terminal. This branch is unreachable in production.
      console.log(
        `[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${
          msg.text ?? msg.html
        }`
      );
      return { ok: true };
    }
    // Recipient and subject only; never the body.
    console.error(
      `[email] RESEND_API_KEY not configured; refusing to drop mail. to=${msg.to} subject=${JSON.stringify(msg.subject)}`
    );
    return { ok: false, detail: "Email sending is not configured" };
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
