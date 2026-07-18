import type { Metadata } from "next";
import { ListTodo } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Today" };

/**
 * Today queue (spec §9.4.1) — a queue, not a dashboard. The six work
 * sections arrive with M3; until then this is the honest empty shell.
 */
export default function AdminTodayPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">
          Work that needs a human, in one list.
        </p>
      </div>
      <EmptyState
        icon={ListTodo}
        sentence="No work in the queue yet. Provisioning tasks, failing payments, waiting conversations, feasibility requests, RICA checks and low stock will appear here as they happen."
      />
    </div>
  );
}
