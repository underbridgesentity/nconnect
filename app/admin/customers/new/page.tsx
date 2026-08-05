import type { Metadata } from "next";
import { BackLink } from "../../back-link";
import { NewCustomerForm } from "./client";

export const metadata: Metadata = { title: "New customer" };

/**
 * Staff-side onboarding for anyone who does not self-serve: walk-ins, phone
 * orders, migrations. Email is required because it is the sign-in credential;
 * without it the account can never reach the portal.
 */
export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <BackLink href="/admin/customers">Customers</BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          New customer
        </h1>
        <p className="text-sm text-muted-foreground">
          For walk-in, phone and migrated customers. The email address becomes
          their sign-in; they receive a code by email whenever they sign in.
        </p>
      </div>
      <NewCustomerForm />
    </div>
  );
}
