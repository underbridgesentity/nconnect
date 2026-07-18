import type { Metadata } from "next";
import { Wifi } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "My services" };

export default function PortalHomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">My services</h1>
      <EmptyState
        icon={Wifi}
        sentence="You don't have any services yet. When you sign up for a plan it will appear here, with its status and next invoice."
      />
    </div>
  );
}
