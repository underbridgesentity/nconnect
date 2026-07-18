import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { outboxDrain } from "@/inngest/functions/outbox";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [outboxDrain],
});
