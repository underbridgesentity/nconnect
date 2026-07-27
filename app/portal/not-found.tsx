import Link from "next/link";
import { Home, LifeBuoy, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

/**
 * Portal 404. Rendered inside the portal shell so the tab bar survives: an
 * old bookmark or a link to a service that is no longer on the account should
 * not eject a customer from the app.
 */
export default function PortalNotFound() {
  return (
    <div className="space-y-5 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          We could not find that.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be old, or it may belong to a service or invoice that is
          no longer on your account. Everything you do have is below.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          className="w-full touch-target"
          render={<Link href="/portal" />}
        >
          <Home className="size-4" aria-hidden />
          My services
        </Button>
        <Button
          variant="outline"
          className="w-full touch-target"
          render={<Link href="/portal/billing" />}
        >
          <Receipt className="size-4" aria-hidden />
          Billing and invoices
        </Button>
        <Button
          variant="ghost"
          className="w-full touch-target"
          render={<Link href="/portal/help" />}
        >
          <LifeBuoy className="size-4" aria-hidden />
          Get help
        </Button>
      </div>
    </div>
  );
}
