import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors";
import { appUrl, errorResponse } from "@/lib/http";

const OAUTH_STATE_COOKIE = "scm_oauth_state";

/** Start "Connect your ad account": redirect the user to the platform's login. */
export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const { platform } = await params;
    const connector = getConnector(platform);
    const state = randomBytes(24).toString("hex");
    const url = connector.getAuthUrl(state, appUrl(`/api/connect/${platform}/callback`));
    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
