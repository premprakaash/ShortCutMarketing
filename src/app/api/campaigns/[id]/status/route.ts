import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { setCampaignStatus } from "@/lib/service";
import { getUserId } from "@/lib/user";

const Body = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) });

/** Pause or resume a campaign. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { status } = Body.parse(await req.json());
    await setCampaignStatus(await getUserId(), id, status);
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return errorResponse(err);
  }
}
