import { NextResponse } from "next/server";
import { AdKitRequestSchema, claudeConfigFromEnv, generateAdKit } from "@/lib/ai/claude";
import { errorResponse } from "@/lib/http";

export const maxDuration = 60;

/** AI writes the video prompt + ad copy for every platform. */
export async function POST(req: Request) {
  try {
    const input = AdKitRequestSchema.parse(await req.json());
    return NextResponse.json({ kit: await generateAdKit(claudeConfigFromEnv(), input) });
  } catch (err) {
    return errorResponse(err);
  }
}
