import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-key";
import { errorResponse } from "@/lib/http";
import { listConnections } from "@/lib/service";

/** ShortcutVid → list a user's connected ad accounts. GET /api/v1/connections?userId=... */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
    return NextResponse.json({ connections: await listConnections(userId) });
  } catch (err) {
    return errorResponse(err);
  }
}
