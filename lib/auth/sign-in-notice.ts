import { roleCanOpen, type Role } from "./permissions";

/**
 * Why a sign-in screen is being shown.
 *
 * The role gate bounces two very different people to the same form: someone
 * with no session at all, and someone signed in on an account that cannot open
 * the page they clicked. Handing both an empty form with no explanation reads
 * as a bug. The second one in particular will retype the password they are
 * already signed in with and watch it "fail" for reasons nothing on the page
 * mentions, when the honest answer is that the account is wrong, not the
 * password.
 *
 * The reason travels as a query parameter and is therefore untrusted, so it is
 * matched against a closed list. The live session is the stronger evidence and
 * wins where the two disagree: someone who really is signed in is told so,
 * whatever the URL claims.
 */

export const SIGN_IN_REASONS = ["role", "session"] as const;
export type SignInReason = (typeof SIGN_IN_REASONS)[number];

/** The `reason` on a sign-in URL, or null when it is absent or invented. */
export function signInReasonFromParams(
  params: Record<string, string | string[] | undefined>
): SignInReason | null {
  const raw = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return (SIGN_IN_REASONS as readonly string[]).includes(value)
    ? (value as SignInReason)
    : null;
}

export type SignInNotice = {
  /** "blocked": this account cannot get in. "info": everything else. */
  tone: "blocked" | "info";
  title: string;
  detail: string;
  /** The page they were trying to open, echoed so it can be shown as a path. */
  destination: string | null;
  /**
   * Somewhere useful for the session they already hold: the page they were
   * after when that account can open it, otherwise the role router. Never a
   * hand-written per-role path, so this cannot become a second opinion on
   * where a role lives.
   */
  onward: { href: string; label: string } | null;
};

/**
 * The two sign-in screens the gate can land someone on, and the sentences that
 * differ between them. Everything else reads the same on both, so it is said
 * once.
 *
 * Staff sign in with an email and a password; customers sign in with a code
 * sent to the email address on their account. "Sign in below with an account that
 * can" is therefore advice nobody can act on in front of the customer form,
 * and that is the only kind of sentence worth splitting in two.
 */
type SignInSurface = "staff" | "customer";

const SURFACE_COPY: Record<
  SignInSurface,
  {
    /** Closes the "that account cannot open it" sentence. */
    wrongAccountAdvice: string;
    /** For a signed-out visitor the gate turned away. */
    needAccountTitle: string;
    needAccountDetail: (hasDestination: boolean) => string;
  }
> = {
  staff: {
    wrongAccountAdvice:
      "Sign in below with an account that can, or carry on where you were.",
    needAccountTitle: "That page needs a staff account",
    needAccountDetail: (hasDestination) =>
      hasDestination
        ? "Sign in with a Needd Connect staff account that has access to it and we will take you straight there."
        : "Sign in with a Needd Connect staff account that has access to it.",
  },
  customer: {
    // Only a staff session ever reaches this line here: a customer who can
    // open the page has already been redirected onto it. So the advice names
    // what this form actually wants, without assuming they hold one.
    wrongAccountAdvice:
      "Sign in below with the email address on a customer account, or carry on where you were.",
    needAccountTitle: "That page needs your customer account",
    needAccountDetail: (hasDestination) =>
      hasDestination
        ? "Sign in with the email address on your Needd Connect account and we will take you straight there."
        : "Sign in with the email address on your Needd Connect account.",
  },
};

const ACCOUNT_PHRASE: Record<Role, string> = {
  admin: "an admin account",
  sales: "a sales account",
  customer: "a customer account",
};

const HOME_LABEL: Record<Role, string> = {
  admin: "Go to the admin dashboard",
  sales: "Go to my sales workspace",
  customer: "Go to my portal",
};

const roleHome = (role: Role) => ({
  href: "/after-login",
  label: HOME_LABEL[role],
});

export type SignInNoticeInput = {
  reason: SignInReason | null;
  /** The role on the live session, null when signed out. */
  role: Role | null;
  /** Email or name, whichever the session carries, for "signed in as". */
  identity: string | null;
  /** Validated relative path, or null. */
  destination: string | null;
};

/**
 * What to say above a sign-in form, or null when there is nothing true to add
 * and the bare form is the honest answer.
 *
 * `destination` must already have been through `safeCallbackUrl`: it is shown
 * to the person and put in the form, so a raw query parameter has no business
 * reaching here.
 *
 * Nothing is asserted that cannot be checked. Telling someone their account
 * cannot open a page requires either the destination and the role gate's own
 * area map, or the gate itself saying so; a signed-in visitor who simply
 * bookmarked this form is not accused of anything.
 */
function signInNotice(
  surface: SignInSurface,
  input: SignInNoticeInput
): SignInNotice | null {
  const copy = SURFACE_COPY[surface];
  const { reason, role, identity, destination } = input;

  if (role) {
    const who = identity
      ? `You are signed in as ${identity}. That is ${ACCOUNT_PHRASE[role]}`
      : `You are signed in on ${ACCOUNT_PHRASE[role]}`;
    const blocked = {
      tone: "blocked" as const,
      title: "That page needs a different account",
      detail: `${who}, and it cannot open that page. ${copy.wrongAccountAdvice}`,
      onward: roleHome(role),
    };

    if (destination) {
      // The destination and the area map settle it outright, so the query
      // string does not get a vote here.
      return roleCanOpen(destination, role)
        ? {
            tone: "info",
            title: "You are already signed in",
            detail: `${who}, and it can open that page. Carry on, or sign in below as someone else.`,
            destination,
            onward: { href: destination, label: "Continue to that page" },
          }
        : { ...blocked, destination };
    }
    // No destination to check: the gate said the role was wrong, and it is the
    // only thing that knows which page did the refusing.
    if (reason === "role") return { ...blocked, destination: null };
    return {
      tone: "info",
      title: "You are already signed in",
      detail: `${who}. Sign in below only if you are switching to a different account.`,
      destination: null,
      onward: roleHome(role),
    };
  }

  if (reason === "role") {
    return {
      tone: "info",
      title: copy.needAccountTitle,
      detail: copy.needAccountDetail(destination !== null),
      destination,
      onward: null,
    };
  }

  if (destination) {
    return {
      tone: "info",
      title: "Sign in to continue",
      detail:
        "You need to be signed in to open that page. Sign in below and we will take you straight there.",
      destination,
      onward: null,
    };
  }

  if (reason === "session") {
    return {
      tone: "info",
      title: "Your session has ended",
      detail: "Sign in again to carry on where you left off.",
      destination: null,
      onward: null,
    };
  }

  return null;
}

/** What to say above the staff sign-in form (email and password). */
export function staffSignInNotice(input: SignInNoticeInput) {
  return signInNotice("staff", input);
}

/**
 * What to say above the customer sign-in form (a code to their email address).
 *
 * The role gate sends a signed-in admin or sales rep who opens a /portal link
 * here, exactly as it sends a customer to the staff form, so this screen has
 * the same duty to explain itself. A signed-in customer never sees it: the page
 * redirects them onward before it renders.
 */
export function customerSignInNotice(input: SignInNoticeInput) {
  return signInNotice("customer", input);
}
