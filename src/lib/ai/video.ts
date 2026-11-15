/**
 * AI video generation through fal.ai's queue API — one key, many models.
 * Docs: https://fal.ai/docs/documentation/model-apis
 *
 * Model IDs and inputs change over time: check each model's page on fal.ai
 * and adjust VIDEO_MODELS below if needed.
 */

export class VideoGenError extends Error {}

export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface VideoModel {
  id: string;
  name: string;
  note: string;
  durations: number[];
  aspects: AspectRatio[];
  input(p: { prompt: string; aspectRatio: AspectRatio; duration: number }): Record<string, unknown>;
}

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "fal-ai/veo3.1",
    name: "Google Veo 3.1",
    note: "Top quality with native sound",
    durations: [4, 6, 8],
    aspects: ["9:16", "16:9"],
    input: ({ prompt, aspectRatio, duration }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration: `${duration}s`,
      generate_audio: true,
    }),
  },
  {
    id: "fal-ai/veo3.1/lite",
    name: "Google Veo 3.1 Lite",
    note: "Cheaper, faster Veo",
    durations: [4, 6, 8],
    aspects: ["9:16", "16:9"],
    input: ({ prompt, aspectRatio, duration }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      duration: `${duration}s`,
      generate_audio: true,
    }),
  },
  {
    id: "fal-ai/kling-video/v3/turbo/pro/text-to-video",
    name: "Kling 3.0 Turbo Pro",
    note: "1080p, smooth motion",
    durations: [5, 10],
    aspects: ["9:16", "16:9", "1:1"],
    input: ({ prompt, aspectRatio, duration }) => ({ prompt, aspect_ratio: aspectRatio, duration: String(duration) }),
  },
  {
    id: "fal-ai/kling-video/v2.6/pro/text-to-video",
    name: "Kling 2.6 Pro",
    note: "Cinematic, with audio",
    durations: [5, 10],
    aspects: ["9:16", "16:9", "1:1"],
    input: ({ prompt, aspectRatio, duration }) => ({ prompt, aspect_ratio: aspectRatio, duration: String(duration) }),
  },
  {
    id: "bytedance/seedance-2.0/text-to-video",
    name: "Seedance 2.0",
    note: "Strong prompt following",
    durations: [5, 10],
    aspects: ["9:16", "16:9", "1:1"],
    input: ({ prompt, aspectRatio, duration }) => ({ prompt, aspect_ratio: aspectRatio, duration: String(duration) }),
  },
];

export function findModel(id: string): VideoModel {
  const m = VIDEO_MODELS.find((x) => x.id === id);
  if (!m) throw new VideoGenError(`Unknown video model: ${id}`);
  return m;
}

export interface FalConfig {
  apiKey: string;
  fetch?: typeof fetch;
}

export function falConfigFromEnv(): FalConfig {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new VideoGenError("Video generation isn't set up yet. Add FAL_KEY to the server settings.");
  return { apiKey };
}

async function falFetch(config: FalConfig, url: string, init: RequestInit = {}) {
  const res = await (config.fetch ?? fetch)(url, {
    ...init,
    headers: { Authorization: `Key ${config.apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, json };
}

function errorText(json: Record<string, unknown>, status: number) {
  const detail = json.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg ?? JSON.stringify(d)).join("; ");
  return String(json.error ?? json.message ?? `Video service error (HTTP ${status})`);
}

/** Put a generation request in fal's queue. */
export async function submitVideo(config: FalConfig, model: VideoModel, prompt: string, aspectRatio: AspectRatio, duration: number) {
  if (!model.aspects.includes(aspectRatio)) throw new VideoGenError(`${model.name} doesn't support ${aspectRatio}`);
  if (!model.durations.includes(duration)) throw new VideoGenError(`${model.name} supports ${model.durations.join("/")} second videos`);
  const { res, json } = await falFetch(config, `https://queue.fal.run/${model.id}`, {
    method: "POST",
    body: JSON.stringify(model.input({ prompt, aspectRatio, duration })),
  });
  if (!res.ok || !json.request_id) throw new VideoGenError(errorText(json, res.status));
  return {
    requestId: String(json.request_id),
    statusUrl: String(json.status_url ?? `https://queue.fal.run/${model.id}/requests/${json.request_id}/status`),
    responseUrl: String(json.response_url ?? `https://queue.fal.run/${model.id}/requests/${json.request_id}`),
  };
}

export type PollResult = { state: "queued" | "running" } | { state: "done"; videoUrl: string } | { state: "failed"; error: string };

/** Check a queued request; fetch the video URL once it's finished. */
export async function pollVideo(config: FalConfig, statusUrl: string, responseUrl: string): Promise<PollResult> {
  const s = await falFetch(config, statusUrl);
  if (!s.res.ok) return { state: "failed", error: errorText(s.json, s.res.status) };
  const status = String(s.json.status ?? "");
  if (status === "IN_QUEUE") return { state: "queued" };
  if (status === "IN_PROGRESS") return { state: "running" };
  if (status !== "COMPLETED") return { state: "failed", error: `Unexpected status: ${status || "unknown"}` };

  const r = await falFetch(config, responseUrl);
  if (!r.res.ok) return { state: "failed", error: errorText(r.json, r.res.status) };
  const video = r.json.video as { url?: string } | string | undefined;
  const url = typeof video === "string" ? video : video?.url;
  if (!url) return { state: "failed", error: "The model finished but returned no video" };
  return { state: "done", videoUrl: url };
}
