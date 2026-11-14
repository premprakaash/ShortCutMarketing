import { NextResponse } from "next/server";
import { safeEqual } from "./crypto";

/**
 * Guard for the server-to-server API that ShortcutVid calls.
 * Returns a 401 response when the key is missing/wrong, otherwise null.
 */
export function requireApiKey(req: Request): NextResponse | null {
  const expected = process.env.SCM_API_KEY;
  if (!expected) return NextResponse.json({ error: "SCM_API_KEY is not configured" }, { status: 503 });
  const given = req.headers.get("x-api-key") ?? "";
  if (!given || !safeEqual(given, expected)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  return null;
}
