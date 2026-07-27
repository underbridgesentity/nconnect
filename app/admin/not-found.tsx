import Link from "next/link";
import { Inbox, ListTodo, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

/**
 * Admin 404, for the `notFound()` calls in the customer 360 and anything
 * nested under /admin.
 *
 * Previously a stale customer link threw an operator out of the workspace and
 * onto the consumer marketing 404, dark hero and "Check coverage" links and
 * all. This keeps the admin shell and points back at the two lists an operator
 * actually wants next.
 */
export default function AdminNotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          We could not find that record.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be old, or the customer, invoice or task it points at may
          have been archived or never existed. Nothing was deleted by opening
          it. Search from the list below to find the real record.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button render={<Link href="/admin/customers" />}>
          <Users className="size-4" aria-hidden />
          Search customers
        </Button>
        <Button variant="outline" render={<Link href="/admin" />}>
          <ListTodo className="size-4" aria-hidden />
          Back to Today
        </Button>
        <Button variant="ghost" render={<Link href="/admin/inbox" />}>
          <Inbox className="size-4" aria-hidden />
          Inbox
        </Button>
      </div>
    </div>
  );
}
