import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, customers } from "@/lib/db/schema";

/**
 * The account behind a verified phone number, and why there isn't one.
 *
 * The Auth.js credentials provider can only answer "yes" or "null", so the
 * sign-in screen would otherwise blame a perfectly good code for a problem that
 * has nothing to do with it. This is the one place the rules for "may this
 * number hold a customer session" live; the provider and the sign-in screen
 * both read it, so they cannot drift apart.
 *
 * Only reached once a code for that number has already been verified, so
 * saying "there is no account here" reveals nothing to anyone who is not
 * holding the phone.
 */
export type CustomerAccount =
  | {
      status: "ok";
      userId: string;
      name: string;
      customerId: string | undefined;
    }
  /** No user at all with this number. */
  | { status: "unknown" }
  /** Blocked by us; sign-in is not the place to argue about it. */
  | { status: "disabled" }
  /** A staff number: real account, wrong door. */
  | { status: "staff" };

export async function findCustomerAccount(
  phone: string
): Promise<CustomerAccount> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);

  if (!user) return { status: "unknown" };
  if (user.status === "disabled") return { status: "disabled" };
  if (user.role !== "customer") return { status: "staff" };

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.userId, user.id))
    .limit(1);

  return {
    status: "ok",
    userId: user.id,
    name: user.name,
    customerId: customer?.id,
  };
}
