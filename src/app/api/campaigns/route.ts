import { NextResponse } from "next/server";
import { z } from "zod";
import { CampaignSpecSchema } from "@/lib/connectors";
import { errorResponse } from "@/lib/http";
import { launchCampaign, listCampaigns } from "@/lib/service";
import { getUserId } from "@/lib/user";

export const maxDuration = 300; // video processing on Meta can take a while

export async function GET() {
  try {
    return NextResponse.json({ campaigns: await listCampaigns(await getUserId()) });
  } catch (err) {
    return errorResponse(err);
  }
}

const LaunchSchema = z.object({ connectionId: z.string().min(1), spec: CampaignSpecSchema });

export async function POST(req: Request) {
  try {
    const { connectionId, spec } = LaunchSchema.parse(await req.json());
    const campaign = await launchCampaign(await getUserId(), connectionId, spec);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
