import { NextResponse } from "next/server";
import { getVideoJob } from "@/lib/ai/video-service";
import { errorResponse } from "@/lib/http";
import { getUserId } from "@/lib/user";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ video: await getVideoJob(await getUserId(), id) });
  } catch (err) {
    return errorResponse(err);
  }
}
