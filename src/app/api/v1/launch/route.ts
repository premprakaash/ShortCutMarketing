import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { MultiLaunchSchema } from "@/lib/connectors";
import { errorResponse } from "@/lib/http";
import { launchMany } from "@/lib/service";

export const maxDuration = 300;

/** ShortcutVid → launch one ad on several platforms for a user. Body: { userId, launch: MultiLaunch } */
export async function POST(req: Request) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  try {
    const body = z.object({ userId: z.string().min(1), launch: MultiLaunchSchema }).parse(await req.json());
    return NextResponse.json(await launchMany(body.userId, body.launch));
  } catch (err) {
    return errorResponse(err);
  }
}
