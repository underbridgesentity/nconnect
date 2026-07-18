import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { outboxDrain } from "@/inngest/functions/outbox";
import { abandonedSignups } from "@/inngest/functions/abandoned-signups";
import { billingRun } from "@/inngest/functions/billing";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [outboxDrain, abandonedSignups, billingRun],
});
