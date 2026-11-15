import { NextResponse } from "next/server";
import { MultiLaunchSchema } from "@/lib/connectors";
import { errorResponse } from "@/lib/http";
import { launchMany } from "@/lib/service";
import { getUserId } from "@/lib/user";

export const maxDuration = 300; // platforms take a while to process videos

/** Launch one ad on several platforms at once. Each result succeeds or fails on its own. */
export async function POST(req: Request) {
  try {
    const input = MultiLaunchSchema.parse(await req.json());
    return NextResponse.json(await launchMany(await getUserId(), input));
  } catch (err) {
    return errorResponse(err);
  }
}
