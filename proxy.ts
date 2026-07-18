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

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = area.loginPath;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const role = token.role as string | undefined;
  if (!role || !area.roles.includes(role)) {
    const url = req.nextUrl.clone();
    url.pathname = area.loginPath;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/sales/:path*", "/portal/:path*"],
};
