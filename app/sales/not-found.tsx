import Link from "next/link";
import { ContactRound, FileText, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

/**
 * Sales 404, for the `notFound()` calls on leads, quotes and customers.
 *
 * A rep hits this most often on a lead or customer that belongs to someone
 * else, because §12 scoping deliberately answers "not found" rather than
 * "forbidden". Saying so plainly is the honest thing, and it keeps the header
 * nav rather than throwing the rep onto the public site.
 */
export default function SalesNotFound() {
  return (
    <div className="space-y-5 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          We could not find that.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be old, or the lead, quote or customer may belong to
          another rep. You only see what is assigned to you. Everything in your
          book is below.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button render={<Link href="/sales" />}>
          <LayoutDashboard className="size-4" aria-hidden />
          My pipeline
        </Button>
        <Button variant="outline" render={<Link href="/sales/leads" />}>
          <ContactRound className="size-4" aria-hidden />
          Leads
        </Button>
        <Button variant="ghost" render={<Link href="/sales/quotes" />}>
          <FileText className="size-4" aria-hidden />
          Quotes
        </Button>
      </div>
    </div>
  );
}
