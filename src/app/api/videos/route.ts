import { NextResponse } from "next/server";
import { createVideoJob, listVideoJobs, VideoRequestSchema } from "@/lib/ai/video-service";
import { errorResponse } from "@/lib/http";
import { getUserId } from "@/lib/user";

/** The user's AI video library (pending jobs are refreshed on read). */
export async function GET() {
  try {
    return NextResponse.json({ videos: await listVideoJobs(await getUserId()) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Start generating a video. Returns immediately; poll /api/videos/{id}. */
export async function POST(req: Request) {
  try {
    const input = VideoRequestSchema.parse(await req.json());
    return NextResponse.json({ video: await createVideoJob(await getUserId(), input) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
