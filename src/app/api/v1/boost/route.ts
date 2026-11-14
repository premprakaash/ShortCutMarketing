import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-key";
import { CampaignSpecSchema } from "@/lib/connectors";
import { errorResponse } from "@/lib/http";
import { launchCampaign } from "@/lib/service";

export const maxDuration = 300;

const Body = z.object({
  userId: z.string().min(1),
  connectionId: z.string().min(1),
  spec: CampaignSpecSchema,
});

/** ShortcutVid → "Boost this video": launch an ad for one of the user's videos. */
export async function POST(req: Request) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  try {
    const { userId, connectionId, spec } = Body.parse(await req.json());
    const campaign = await launchCampaign(userId, connectionId, spec);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
