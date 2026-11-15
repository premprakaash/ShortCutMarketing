import { z } from "zod";
import { CALL_TO_ACTIONS } from "../connectors/types";

/**
 * Ad copy + video prompt generation with Claude (Anthropic Messages API).
 * Uses forced tool use so the answer always comes back as structured JSON.
 */

export class AiError extends Error {}

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

export function claudeConfigFromEnv(): ClaudeConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiError("AI writing isn't set up yet. Add ANTHROPIC_API_KEY to the server settings.");
  return { apiKey, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" };
}

async function callTool<T>(
  config: ClaudeConfig,
  system: string,
  user: string,
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
): Promise<T> {
  const res = await (config.fetch ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; input?: unknown }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new AiError(json.error?.message ?? `AI request failed (HTTP ${res.status})`);
  const block = json.content?.find((b) => b.type === "tool_use" && b.name === tool.name);
  if (!block) throw new AiError("The AI didn't return a usable answer. Please try again.");
  return block.input as T;
}

export const AdKitRequestSchema = z.object({
  product: z.string().trim().min(3).max(2000),
  audience: z.string().trim().max(500).default(""),
  offer: z.string().trim().max(300).default(""),
  tone: z.string().trim().max(100).default("friendly and confident"),
  language: z.string().trim().max(40).default("English"),
  objective: z.enum(["traffic", "awareness", "video_views"]).default("traffic"),
  brand: z.string().trim().max(60).default(""),
});
export type AdKitRequest = z.infer<typeof AdKitRequestSchema>;

export interface AdKit {
  campaignName: string;
  videoPrompt: string;
  primaryText: string;
  headline: string;
  headlines: string[];
  descriptions: string[];
  longHeadline: string;
  businessName: string;
  keywords: string[];
  callToAction: (typeof CALL_TO_ACTIONS)[number];
}

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const clipAll = (arr: unknown, n: number, max: number) =>
  (Array.isArray(arr) ? arr : [])
    .map((s) => clip(s, n))
    .filter(Boolean)
    .slice(0, max);

/** Enforce every platform's length limits, whatever the model returned. */
export function sanitizeAdKit(raw: Record<string, unknown>): AdKit {
  const cta = String(raw.callToAction ?? "LEARN_MORE");
  return {
    campaignName: clip(raw.campaignName, 80) || "New campaign",
    videoPrompt: clip(raw.videoPrompt, 1500),
    primaryText: clip(raw.primaryText, 500),
    headline: clip(raw.headline, 40),
    headlines: clipAll(raw.headlines, 30, 10),
    descriptions: clipAll(raw.descriptions, 90, 4),
    longHeadline: clip(raw.longHeadline, 90),
    businessName: clip(raw.businessName, 25),
    keywords: clipAll(raw.keywords, 80, 20),
    callToAction: (CALL_TO_ACTIONS as readonly string[]).includes(cta) ? (cta as AdKit["callToAction"]) : "LEARN_MORE",
  };
}

const AD_KIT_TOOL = {
  name: "save_ad_kit",
  description: "Save a complete multi-platform video ad kit.",
  input_schema: {
    type: "object",
    required: [
      "campaignName",
      "videoPrompt",
      "primaryText",
      "headline",
      "headlines",
      "descriptions",
      "longHeadline",
      "businessName",
      "keywords",
      "callToAction",
    ],
    properties: {
      campaignName: { type: "string", description: "Short internal campaign name" },
      videoPrompt: {
        type: "string",
        description:
          "A detailed prompt for an AI video model: shot type, subject, action, setting, lighting, camera movement, style and audio cues. One continuous 5–8 second shot. No on-screen text or logos.",
      },
      primaryText: { type: "string", description: "Main ad text, max 500 characters, hook in the first line" },
      headline: { type: "string", description: "Headline, max 40 characters" },
      headlines: { type: "array", items: { type: "string" }, description: "5–10 distinct short headlines, each max 30 characters" },
      descriptions: { type: "array", items: { type: "string" }, description: "3–4 descriptions, each max 90 characters" },
      longHeadline: { type: "string", description: "Long headline, max 90 characters" },
      businessName: { type: "string", description: "Brand name, max 25 characters" },
      keywords: { type: "array", items: { type: "string" }, description: "10–20 Google Search keywords people would type" },
      callToAction: { type: "string", enum: [...CALL_TO_ACTIONS] },
    },
  },
};

export async function generateAdKit(config: ClaudeConfig, req: AdKitRequest): Promise<AdKit> {
  const system =
    "You are a senior performance marketer who writes video ads that run on Meta, Google/YouTube, TikTok, LinkedIn, " +
    "Pinterest and Snapchat. Write clear, specific, benefit-led copy. Respect every character limit exactly. " +
    "Never invent prices, discounts, awards or claims that the user didn't give you. Avoid ALL CAPS and excessive punctuation " +
    "(ad platforms reject them).";
  const user = [
    `Product or service: ${req.product}`,
    req.brand && `Brand name: ${req.brand}`,
    req.audience && `Target audience: ${req.audience}`,
    req.offer && `Offer: ${req.offer}`,
    `Goal: ${{ traffic: "get website visits", awareness: "reach as many people as possible", video_views: "get the video watched" }[req.objective]}`,
    `Tone: ${req.tone}`,
    `Write all ad text in ${req.language}. Write the video prompt in English.`,
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await callTool<Record<string, unknown>>(config, system, user, AD_KIT_TOOL);
  return sanitizeAdKit(raw);
}

export const PromptRequestSchema = z.object({
  idea: z.string().trim().min(3).max(1500),
  style: z.string().trim().max(200).default("cinematic, high-end commercial"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  duration: z.number().int().min(2).max(20).default(8),
});

export async function writeVideoPrompt(config: ClaudeConfig, req: z.infer<typeof PromptRequestSchema>): Promise<string> {
  const raw = await callTool<{ prompt: string }>(
    config,
    "You write prompts for AI video models (Veo, Kling, Seedance). Describe one continuous shot: shot type, subject, action, " +
      "environment, lighting, camera movement, style and audio. Be concrete and visual. No on-screen text, logos or real people.",
    `Idea: ${req.idea}\nStyle: ${req.style}\nFormat: ${req.aspectRatio}, about ${req.duration} seconds.`,
    {
      name: "save_prompt",
      description: "Save the finished video prompt.",
      input_schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
    },
  );
  return clip(raw.prompt, 1500);
}
