import { NextResponse } from "next/server";
import { claudeConfigFromEnv, PromptRequestSchema, writeVideoPrompt } from "@/lib/ai/claude";
import { errorResponse } from "@/lib/http";

export const maxDuration = 60;

/** AI turns a rough idea into a detailed video-model prompt. */
export async function POST(req: Request) {
  try {
    const input = PromptRequestSchema.parse(await req.json());
    return NextResponse.json({ prompt: await writeVideoPrompt(claudeConfigFromEnv(), input) });
  } catch (err) {
    return errorResponse(err);
  }
}
