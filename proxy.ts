import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

/**
 * Route-group session + role gate (spec §3.2), Next 16 "proxy" convention.
 * Fine-grained checks live in authorize(); this only keeps the wrong role
 * (or no session) out of each surface. Disabled users are hard-blocked here.
 */

const ROLE_AREAS: { prefix: string; roles: string[]; loginPath: string }[] = [
  { prefix: "/admin", roles: ["admin"], loginPath: "/staff-login" },
  { prefix: "/sales", roles: ["sales", "admin"], loginPath: "/staff-login" },
  { prefix: "/portal", roles: ["customer"], loginPath: "/login" },
];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const area = ROLE_AREAS.find((a) => pathname.startsWith(a.prefix));
  if (!area) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    // next-auth v5 cookie names
    cookieName:
      process.env.NODE_ENV === "production"
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
  });

  const { loginPath } = area;
  /**
   * Send someone to the area's sign-in screen, carrying where they were going
   * and, when we can say it truthfully, why they were stopped.
   *
   * Both values are read back through `callbackUrlFromParams` and
   * `signInReasonFromParams`, which validate them: the destination is
   * same-origin by construction here, but it survives a round trip through the
   * browser before anyone acts on it. The blocked request's own query string is
   * dropped from the sign-in URL rather than inherited, so a link crafted with
   * its own `reason` cannot put words in the screen's mouth; it still travels
   * intact inside `next`.
   */
  function signIn(reason?: "role") {
    const url = req.nextUrl.clone();
    url.pathname = loginPath;
    url.search = "";
    // Keep the query string on the destination: a customer following a link
    // like /portal/billing?invoice=123 must land back on that exact view, not
    // a bare /portal/billing with the context stripped.
    url.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
    if (reason) url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
  }

  // No session at all. No reason is attached: a missing cookie cannot tell an
  // expired session apart from a first visit, and "your session has ended" is
  // not something we know. The destination alone is enough for the screen to
  // say "sign in and we will take you there".
  if (!token) return signIn();

  const role = token.role as string | undefined;
  if (!role || !area.roles.includes(role)) {
    // The wrong-role case used to drop both, so a signed-in person landed on a
    // bare form with nothing to explain the bounce and no way back to the page
    // they clicked. They would retype a password that was never the problem.
    // The screen needs the destination to offer it back, and the reason to
    // know the gate refused rather than that they simply opened the form.
    return signIn("role");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/sales/:path*", "/portal/:path*"],
};
