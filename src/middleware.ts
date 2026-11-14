import { NextResponse, type NextRequest } from "next/server";

const USER_COOKIE = "scm_uid";

/** Give every browser a stable anonymous user ID (see src/lib/user.ts). */
export function middleware(req: NextRequest) {
  if (req.cookies.get(USER_COOKIE)) return NextResponse.next();

  const id = crypto.randomUUID();
  // Make the new ID visible to this same request, then persist it.
  req.cookies.set(USER_COOKIE, id);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(USER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}

export const config = {
  // Server-to-server API (/api/v1) uses an API key instead of a cookie.
  matcher: ["/((?!_next/|favicon.ico|api/v1/).*)"],
};
