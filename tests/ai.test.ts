import { describe, expect, it } from "vitest";
import { AdKitRequestSchema, generateAdKit, sanitizeAdKit } from "@/lib/ai/claude";
import { findModel, pollVideo, submitVideo } from "@/lib/ai/video";
import { fakeApi } from "./helpers";

describe("AI ad kit (Claude)", () => {
  it("forces a tool call and enforces platform limits", async () => {
    const api = fakeApi({
      "POST api.anthropic.com/v1/messages": () => ({
        content: [
          {
            type: "tool_use",
            name: "save_ad_kit",
            input: {
              campaignName: "Cold brew launch",
              videoPrompt: "Slow dolly shot of iced coffee",
              primaryText: "Your mornings, upgraded.",
              headline: "Cold brew that actually tastes good — delivered to your door",
              headlines: ["Fresh cold brew", "This headline is far too long for Google search ads", "Order today"],
              descriptions: ["Small-batch coffee, brewed for 18 hours."],
              longHeadline: "Small-batch cold brew delivered across Bengaluru",
              businessName: "Brew Bros Coffee Company Private Limited",
              keywords: ["cold brew", "iced coffee delivery"],
              callToAction: "BUY_IT_NOW",
            },
          },
        ],
      }),
    });
    const kit = await generateAdKit(
      { apiKey: "k", model: "claude-sonnet-5-5", fetch: api.fetchImpl },
      AdKitRequestSchema.parse({ product: "Cold brew coffee delivery" }),
    );
    const req = api.calls[0];
    expect(req.headers["x-api-key"]).toBe("k");
    expect(req.body).toMatchObject({ model: "claude-sonnet-5-5", tool_choice: { type: "tool", name: "save_ad_kit" } });
    expect(kit.headline.length).toBeLessThanOrEqual(40);
    expect(kit.headlines.every((h) => h.length <= 30)).toBe(true);
    expect(kit.businessName.length).toBeLessThanOrEqual(25);
    expect(kit.callToAction).toBe("LEARN_MORE"); // unknown CTA falls back
  });

  it("sanitizes junk safely", () => {
    const kit = sanitizeAdKit({ headlines: "nope", keywords: [1, "", "ok"] });
    expect(kit.headlines).toEqual([]);
    expect(kit.keywords).toEqual(["1", "ok"]);
    expect(kit.campaignName).toBe("New campaign");
  });

  it("reports API errors", async () => {
    const api = fakeApi({ "POST api.anthropic.com/v1/messages": () => ({ status: 401, body: { error: { message: "invalid x-api-key" } } }) });
    await expect(
      generateAdKit({ apiKey: "bad", model: "m", fetch: api.fetchImpl }, AdKitRequestSchema.parse({ product: "abc" })),
    ).rejects.toThrow("invalid x-api-key");
  });
});

describe("AI video (fal.ai)", () => {
  const veo = findModel("fal-ai/veo3.1");

  it("submits to the queue with model-specific inputs", async () => {
    const api = fakeApi({
      "POST queue.fal.run/fal-ai/veo3.1": () => ({
        request_id: "r1",
        status_url: "https://queue.fal.run/fal-ai/veo3.1/requests/r1/status",
        response_url: "https://queue.fal.run/fal-ai/veo3.1/requests/r1",
      }),
    });
    const q = await submitVideo({ apiKey: "fk", fetch: api.fetchImpl }, veo, "a coffee shot", "9:16", 8);
    expect(q.requestId).toBe("r1");
    expect(api.calls[0].headers.authorization).toBe("Key fk");
    expect(api.calls[0].body).toEqual({ prompt: "a coffee shot", aspect_ratio: "9:16", duration: "8s", generate_audio: true });
  });

  it("rejects unsupported formats before spending money", async () => {
    await expect(submitVideo({ apiKey: "k", fetch: fetch }, veo, "x x x", "1:1", 8)).rejects.toThrow(/1:1/);
    await expect(submitVideo({ apiKey: "k", fetch: fetch }, veo, "x x x", "9:16", 5)).rejects.toThrow(/second/);
  });

  it("polls until done and returns the video URL", async () => {
    let n = 0;
    const api = fakeApi({
      "GET queue.fal.run/fal-ai/veo3.1/requests/r1/status": () => ({ status: ++n < 2 ? "IN_PROGRESS" : "COMPLETED" }),
      "GET queue.fal.run/fal-ai/veo3.1/requests/r1": () => ({ video: { url: "https://v3.fal.media/files/x.mp4" } }),
    });
    const cfg = { apiKey: "k", fetch: api.fetchImpl };
    const s = "https://queue.fal.run/fal-ai/veo3.1/requests/r1/status";
    const r = "https://queue.fal.run/fal-ai/veo3.1/requests/r1";
    expect(await pollVideo(cfg, s, r)).toEqual({ state: "running" });
    expect(await pollVideo(cfg, s, r)).toEqual({ state: "done", videoUrl: "https://v3.fal.media/files/x.mp4" });
  });

  it("marks failures", async () => {
    const api = fakeApi({
      "GET queue.fal.run/x/status": () => ({ status: "COMPLETED" }),
      "GET queue.fal.run/x": () => ({ status: 422, body: { detail: [{ msg: "Prompt was flagged" }] } }),
    });
    expect(await pollVideo({ apiKey: "k", fetch: api.fetchImpl }, "https://queue.fal.run/x/status", "https://queue.fal.run/x")).toEqual({
      state: "failed",
      error: "Prompt was flagged",
    });
  });
});
