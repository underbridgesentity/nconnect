import "server-only";

/**
 * Pluggable SMS adapter (spec §3): console driver in dev; SMSPortal or
 * Clickatell wired via env in production. OTP fallback channel only at launch.
 */

export interface SmsAdapter {
  readonly name: string;
  send(to: string, body: string): Promise<{ ok: boolean; detail?: string }>;
}

const consoleAdapter: SmsAdapter = {
  name: "console",
  async send(to, body) {
    console.log(`[sms:console] to=${to} body=${JSON.stringify(body)}`);
    return { ok: true };
  },
};

function httpAdapter(provider: "smsportal" | "clickatell"): SmsAdapter {
  return {
    name: provider,
    async send(to, body) {
      const apiKey = process.env.SMS_API_KEY;
      if (!apiKey) {
        return { ok: false, detail: `${provider}: SMS_API_KEY not configured` };
      }
      if (provider === "smsportal") {
        const res = await fetch("https://rest.smsportal.com/bulkmessages", {
          method: "POST",
          headers: {
            Authorization: `Basic ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{ destination: to, content: body }],
          }),
        });
        return res.ok
          ? { ok: true }
          : { ok: false, detail: `smsportal ${res.status}: ${await res.text()}` };
      }
      const res = await fetch("https://platform.clickatell.com/messages", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ channel: "sms", to, content: body }],
        }),
      });
      return res.ok
        ? { ok: true }
        : { ok: false, detail: `clickatell ${res.status}: ${await res.text()}` };
    },
  };
}

export function getSmsAdapter(): SmsAdapter {
  const provider = process.env.SMS_PROVIDER ?? "console";
  switch (provider) {
    case "smsportal":
    case "clickatell":
      return httpAdapter(provider);
    default:
      return consoleAdapter;
  }
}
