import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, customers } from "@/lib/db/schema";
import { normalizeEmail } from "./otp";

/**
 * The account behind a verified identifier, and why there isn't one.
 *
 * The Auth.js credentials provider can only answer "yes" or "null", so the
 * sign-in screen would otherwise blame a perfectly good code for a problem that
 * has nothing to do with it. This is the one place the rules for "may this
 * person hold a customer session" live; the provider and the sign-in screen
 * both read it, so they cannot drift apart.
 *
 * Only reached once a code for that identifier has already been verified, so
 * saying "there is no account here" reveals nothing to anyone who is not
 * already reading that inbox or holding that phone.
 */
export type CustomerAccount =
  | {
      status: "ok";
      userId: string;
      name: string;
      customerId: string | undefined;
    }
  /** No user at all with this identifier. */
  | { status: "unknown" }
  /**
   * Not allowed to hold a session: disabled, or any status that is not
   * "active". Sign-in is not the place to argue about it.
   */
  | { status: "disabled" }
  /** A staff account: real account, wrong door. */
  | { status: "staff" };

type UserRow = Pick<
  typeof users.$inferSelect,
  "id" | "name" | "role" | "status"
>;

async function accountFor(user: UserRow | undefined): Promise<CustomerAccount> {
  if (!user) return { status: "unknown" };
  // Wrong door first: a staff account is a staff account whatever its status.
  if (user.role !== "customer") return { status: "staff" };
  // Allowlist, not blocklist: only "active" may hold a customer session. Any
  // status added later (suspended, pending review) is fail-closed here rather
  // than silently waved through, and sign-in never mutates the status to fit.
  if (user.status !== "active") return { status: "disabled" };

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

/**
 * The account for an email address. The customer sign-in path.
 *
 * Matched on lower(email) rather than on the raw column, so it reads exactly
 * the way the unique index writes: an address stored in mixed case by some
 * earlier import is still the same account, and cannot become an account that
 * exists but nobody can sign in to.
 */
export async function findCustomerAccountByEmail(
  rawEmail: string
): Promise<CustomerAccount> {
  let email: string;
  try {
    email = normalizeEmail(rawEmail);
  } catch {
    return { status: "unknown" };
  }

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  return accountFor(user);
}

/**
 * The account for a phone number.
 *
 * Not a sign-in path any more: email is the only customer credential. This
 * stays for the flows that hold a number and need to know whose it is, such as
 * matching a lead or an order to an existing customer.
 */
export async function findCustomerAccountByPhone(
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

  return accountFor(user);
}

/**
 * Is this address free for a new account, and if not, whose is it?
 *
 * Signup asks before it inserts. users.email is uniquely indexed, so writing a
 * duplicate raises a constraint violation and the customer gets a 500 in the
 * middle of buying something. Asking first turns that into a sentence they can
 * act on: sign in instead, or use another address.
 */
export type EmailAvailability =
  /** Nobody holds it. Safe to create, subject to the usual insert race. */
  | { status: "free"; email: string }
  /** Held by a customer: the answer is "sign in", not "pick another". */
  | { status: "taken"; email: string; by: "customer"; userId: string }
  /** Held by a staff login: a customer account cannot share it. */
  | { status: "taken"; email: string; by: "staff"; userId: string }
  /** Not an address we can send a code to, so not an address we can accept. */
  | { status: "invalid" };

export async function checkEmailAvailability(
  rawEmail: string
): Promise<EmailAvailability> {
  let email: string;
  try {
    email = normalizeEmail(rawEmail);
  } catch {
    return { status: "invalid" };
  }

  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (!user) return { status: "free", email };
  return {
    status: "taken",
    email,
    by: user.role === "customer" ? "customer" : "staff",
    userId: user.id,
  };
}

/** The one wording for an address that is already spoken for. */
export function emailTakenMessage(availability: EmailAvailability): string {
  if (availability.status === "invalid") {
    return "That does not look like an email address we can send a code to. Check it and try again.";
  }
  if (availability.status === "free") return "";
  return availability.by === "customer"
    ? "You already have a Needd Connect account with that email address. Sign in and we will carry on from there."
    : "That email address is already in use on a Needd Connect staff login. Use a different address for this account.";
}
