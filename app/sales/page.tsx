import type { Metadata } from "next";
import { ContactRound } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Sales" };

export default function SalesHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Leads, quotes and this month&apos;s wins.
        </p>
      </div>
      <EmptyState
        icon={ContactRound}
        sentence="No leads yet. The pipeline, quote tracking and commission view arrive with the sales milestone; captured leads will appear here."
      />
    </div>
  );
}
