import { describe, expect, it } from "vitest";
import { buildTargeting, createMetaConnector, MetaApiError, toMinorUnits } from "@/lib/connectors/meta";
import { CampaignSpecSchema } from "@/lib/connectors/types";

type Call = { method: string; path: string; params: Record<string, string> };

/** A fake Graph API: records calls and answers from a route table. */
function fakeGraph(routes: Record<string, (p: Record<string, string>) => unknown>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const params: Record<string, string> = {};
    const src = method === "POST" ? new URLSearchParams(String(init?.body)) : url.searchParams;
    src.forEach((v, k) => (params[k] = v));
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    calls.push({ method, path, params });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ error: { message: `no route ${method} ${path}` } }), { status: 400 });
    const body = handler(params);
    const isErr = typeof body === "object" && body !== null && "error" in body;
    return new Response(JSON.stringify(body), { status: isErr ? 400 : 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const spec = CampaignSpecSchema.parse({
  name: "Diwali boost",
  objective: "traffic",
  dailyBudget: 500,
  audience: { countries: ["in"], ageMin: 21, ageMax: 45, gender: "female" },
  creative: {
    videoUrl: "https://cdn.example.com/v.mp4",
    primaryText: "Big Diwali sale",
    headline: "50% off",
    linkUrl: "https://shop.example.com",
  },
});

const ctx = { accessToken: "tok", adAccountId: "123", currency: "INR", pageId: "page1" };

function connector(routes: Record<string, (p: Record<string, string>) => unknown>) {
  const g = fakeGraph(routes);
  const c = createMetaConnector({
    appId: "app",
    appSecret: "secret",
    apiVersion: "v25.0",
    fetch: g.fetchImpl,
    sleep: async () => {},
    mediaPollMs: 1,
  });
  return { c, calls: g.calls };
}

const happyRoutes = () => {
  let polls = 0;
  return {
    "POST /act_123/advideos": () => ({ id: "vid1" }),
    "POST /act_123/campaigns": () => ({ id: "camp1" }),
    "POST /act_123/adsets": () => ({ id: "set1" }),
    "GET /vid1": () => ({ status: { video_status: ++polls < 2 ? "processing" : "ready" } }),
    "GET /vid1/thumbnails": () => ({ data: [{ uri: "https://t/1.jpg" }, { uri: "https://t/2.jpg", is_preferred: true }] }),
    "POST /act_123/adcreatives": () => ({ id: "cr1" }),
    "POST /act_123/ads": () => ({ id: "ad1" }),
    "POST /camp1": () => ({ success: true }),
    "DELETE /camp1": () => ({ success: true }),
  };
};

describe("Meta connector", () => {
  it("converts budgets to minor units", () => {
    expect(toMinorUnits(500, "INR")).toBe(50000);
    expect(toMinorUnits(12.345, "USD")).toBe(1235);
    expect(toMinorUnits(1000, "JPY")).toBe(1000);
  });

  it("builds targeting from the unified audience", () => {
    expect(buildTargeting(spec)).toEqual({
      geo_locations: { countries: ["IN"] },
      age_min: 21,
      age_max: 45,
      targeting_automation: { advantage_audience: 0 },
      genders: [2],
    });
  });

  it("creates video → campaign → ad set → creative → ad, paused by default", async () => {
    const { c, calls } = connector(happyRoutes());
    const result = await c.launchCampaign(ctx, spec);

    expect(result.status).toBe("PAUSED");
    expect(result.platformIds).toEqual({
      videoId: "vid1",
      campaignId: "camp1",
      adSetId: "set1",
      creativeId: "cr1",
      adId: "ad1",
    });

    const campaign = calls.find((x) => x.path === "/act_123/campaigns")!;
    expect(campaign.params.objective).toBe("OUTCOME_TRAFFIC");
    expect(campaign.params.status).toBe("PAUSED");
    expect(campaign.params.special_ad_categories).toBe("[]");

    const adset = calls.find((x) => x.path === "/act_123/adsets")!;
    expect(adset.params.daily_budget).toBe("50000");
    expect(adset.params.optimization_goal).toBe("LINK_CLICKS");
    expect(adset.params.destination_type).toBe("WEBSITE");

    const creative = calls.find((x) => x.path === "/act_123/adcreatives")!;
    const story = JSON.parse(creative.params.object_story_spec);
    expect(story.page_id).toBe("page1");
    expect(story.video_data.image_url).toBe("https://t/2.jpg"); // preferred thumbnail
    expect(story.video_data.call_to_action).toEqual({ type: "LEARN_MORE", value: { link: "https://shop.example.com" } });

    // every authenticated call is signed with appsecret_proof
    for (const call of calls) {
      expect(call.params.access_token).toBe("tok");
      expect(call.params.appsecret_proof).toMatch(/^[a-f0-9]{64}$/);
    }
    // never switched on
    expect(calls.some((x) => x.path === "/camp1" && x.method === "POST")).toBe(false);
  });

  it("activates the campaign only at the end when launchActive is set", async () => {
    const { c, calls } = connector(happyRoutes());
    const result = await c.launchCampaign(ctx, { ...spec, launchActive: true });
    expect(result.status).toBe("ACTIVE");
    const last = calls[calls.length - 1];
    expect(last).toMatchObject({ method: "POST", path: "/camp1", params: { status: "ACTIVE" } });
  });

  it("rolls back the campaign if a later step fails", async () => {
    const routes = {
      ...happyRoutes(),
      "POST /act_123/ads": () => ({ error: { message: "Invalid", error_user_msg: "Your ad was rejected" } }),
    };
    const { c, calls } = connector(routes);
    await expect(c.launchCampaign(ctx, spec)).rejects.toThrow("Your ad was rejected");
    expect(calls.some((x) => x.method === "DELETE" && x.path === "/camp1")).toBe(true);
  });

  it("fails clearly when the video can't be processed", async () => {
    const routes = { ...happyRoutes(), "GET /vid1": () => ({ status: { video_status: "error" } }) };
    const { c } = connector(routes);
    await expect(c.launchCampaign(ctx, spec)).rejects.toBeInstanceOf(MetaApiError);
  });

  it("requires a Facebook page", async () => {
    const { c, calls } = connector(happyRoutes());
    await expect(c.launchCampaign({ ...ctx, pageId: null }, spec)).rejects.toThrow(/Facebook Page/);
    expect(calls).toHaveLength(0);
  });

  it("parses insights", async () => {
    const { c } = connector({
      "GET /camp1/insights": () => ({
        data: [
          {
            spend: "123.45",
            impressions: "1000",
            reach: "800",
            clicks: "40",
            ctr: "4.0",
            cpc: "3.08",
            actions: [{ action_type: "video_view", value: "300" }],
          },
        ],
      }),
    });
    expect(await c.getInsights(ctx, { campaignId: "camp1" })).toEqual({
      spend: 123.45,
      impressions: 1000,
      reach: 800,
      clicks: 40,
      ctr: 4,
      cpc: 3.08,
      videoViews: 300,
    });
  });

  it("exchanges an OAuth code for a long-lived token", async () => {
    const { c, calls } = connector({
      "GET /oauth/access_token": (p) =>
        p.grant_type === "fb_exchange_token" ? { access_token: "long", expires_in: 5_184_000 } : { access_token: "short" },
      "GET /me": () => ({ name: "Prem" }),
    });
    const t = await c.exchangeCode("code1", "https://app/cb");
    expect(t.accessToken).toBe("long");
    expect(t.displayName).toBe("Prem");
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(calls[0].params.code).toBe("code1");
  });

  it("builds the login URL with ad permissions", () => {
    const { c } = connector({});
    const url = new URL(c.getAuthUrl("st", "https://app/cb"));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("scope")).toContain("ads_management");
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("Campaign spec validation", () => {
  it("rejects bad input", () => {
    const r = CampaignSpecSchema.safeParse({
      ...spec,
      audience: { ...spec.audience, ageMin: 50, ageMax: 20 },
      creative: { ...spec.creative, videoUrl: "not a url" },
    });
    expect(r.success).toBe(false);
  });

  it("defaults to paused", () => {
    expect(spec.launchActive).toBe(false);
    expect(spec.creative.callToAction).toBe("LEARN_MORE");
  });
});
