import { NextResponse, type NextRequest } from "next/server";
import { getConnector } from "@/lib/connectors";
import { safeEqual } from "@/lib/crypto";
import { appUrl } from "@/lib/http";
import { saveConnection } from "@/lib/service";
import { getUserId } from "@/lib/user";

const OAUTH_STATE_COOKIE = "scm_oauth_state";

/** OAuth redirect target: verify state, swap the code for a token, save the connection. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const back = (query: string) => {
    const res = NextResponse.redirect(appUrl(`/connections?${query}`));
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  };

  try {
    const url = req.nextUrl;
    const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (denied) return back(`error=${encodeURIComponent(denied)}`);

    const state = url.searchParams.get("state") ?? "";
    const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
    if (!state || !expected || !safeEqual(state, expected)) {
      return back(`error=${encodeURIComponent("Login expired or was tampered with. Please try again.")}`);
    }
    const code = url.searchParams.get("code");
    if (!code) return back(`error=${encodeURIComponent("No authorization code returned")}`);

    const connector = getConnector(platform);
    const token = await connector.exchangeCode(code, appUrl(`/api/connect/${platform}/callback`));
    const id = await saveConnection(await getUserId(), platform, token);
    return back(`connected=${id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not connect account";
    return back(`error=${encodeURIComponent(msg)}`);
  }
}
