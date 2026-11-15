import { describe, expect, it } from "vitest";
import { createLinkedInConnector } from "@/lib/connectors/linkedin";
import { createPinterestConnector } from "@/lib/connectors/pinterest";
import { createSnapchatConnector } from "@/lib/connectors/snapchat";
import { createTikTokConnector } from "@/lib/connectors/tiktok";
import { baseSpec, fakeApi, testDeps, VIDEO_BYTES } from "./helpers";

const video = () => ({ raw: VIDEO_BYTES, headers: { "content-type": "video/mp4" } });

// ---------------------------------------------------------------- TikTok
describe("TikTok connector", () => {
  const T = "business-api.tiktok.com/open_api/v1.3";
  const ok = (data: unknown) => ({ code: 0, message: "OK", data });
  const ctx = { accessToken: "tok", adAccountId: "adv1", currency: "INR", pageId: "CUSTOMIZED_USER:id9" };

  function make(over: Parameters<typeof fakeApi>[0] = {}) {
    const api = fakeApi({
      [`POST ${T}/file/video/ad/upload/`]: () => ok([{ video_id: "v1" }]),
      [`POST ${T}/file/image/ad/upload/`]: () => ok({ image_id: "img1" }),
      [`POST ${T}/campaign/create/`]: () => ok({ campaign_id: "c1" }),
      [`POST ${T}/adgroup/create/`]: () => ok({ adgroup_id: "g1" }),
      [`POST ${T}/ad/create/`]: () => ok({ ad_ids: ["a1"] }),
      [`POST ${T}/campaign/status/update/`]: () => ok({}),
      ...over,
    });
    return { c: createTikTokConnector({ appId: "app", secret: "s", fetch: api.fetchImpl, ...testDeps }), calls: api.calls };
  }

  it("uploads by URL and builds campaign → ad group → ad", async () => {
    const { c, calls } = make();
    const r = await c.launchCampaign(ctx, baseSpec);
    expect(r.platformIds).toMatchObject({ videoId: "v1", imageId: "img1", campaignId: "c1", adGroupId: "g1", adId: "a1" });
    expect(calls[0].headers["access-token"]).toBe("tok");
    const camp = calls.find((x) => x.path.endsWith("/campaign/create/"))!.body as Record<string, unknown>;
    expect(camp).toMatchObject({ objective_type: "TRAFFIC", operation_status: "DISABLE" });
    const g = calls.find((x) => x.path.endsWith("/adgroup/create/"))!.body as Record<string, unknown>;
    expect(g).toMatchObject({ location_ids: ["1269750"], budget: 500, gender: "GENDER_FEMALE", budget_mode: "BUDGET_MODE_DAY" });
    expect(g.age_groups).toEqual(["AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54"]);
    const ad = (calls.find((x) => x.path.endsWith("/ad/create/"))!.body as { creatives: Record<string, unknown>[] }).creatives[0];
    expect(ad).toMatchObject({ identity_type: "CUSTOMIZED_USER", identity_id: "id9", video_id: "v1", image_ids: ["img1"] });
    expect(calls.some((x) => x.path.endsWith("/campaign/status/update/"))).toBe(false);
  });

  it("deletes the campaign if the ad fails", async () => {
    const { c, calls } = make({ [`POST ${T}/ad/create/`]: () => ({ code: 40002, message: "Ad text not allowed" }) });
    await expect(c.launchCampaign(ctx, baseSpec)).rejects.toThrow("Ad text not allowed");
    const del = calls.find((x) => x.path.endsWith("/campaign/status/update/"))!.body as Record<string, unknown>;
    expect(del.operation_status).toBe("DELETE");
  });

  it("needs an identity and a supported country", async () => {
    const { c } = make();
    await expect(c.launchCampaign({ ...ctx, pageId: null }, baseSpec)).rejects.toThrow(/identity/);
    await expect(c.launchCampaign(ctx, { ...baseSpec, audience: { ...baseSpec.audience, countries: ["ZZ"] } })).rejects.toThrow(/ZZ/);
  });
});

// ---------------------------------------------------------------- LinkedIn
describe("LinkedIn connector", () => {
  const L = "api.linkedin.com/rest";
  const ctx = { accessToken: "tok", adAccountId: "507", currency: "USD", pageId: "urn:li:organization:42" };

  function make() {
    let polls = 0;
    const api = fakeApi({
      "GET cdn.example.com/v.mp4": video,
      [`POST ${L}/videos`]: ({ url }) =>
        url.search.includes("initializeUpload")
          ? {
              value: {
                video: "urn:li:video:V1",
                uploadToken: "",
                uploadInstructions: [{ uploadUrl: "https://upload.linkedin.test/part1", firstByte: 0, lastByte: VIDEO_BYTES.length - 1 }],
              },
            }
          : {},
      "PUT upload.linkedin.test/part1": () => ({ body: {}, headers: { etag: "etag-1" } }),
      [`GET ${L}/videos/`]: () => ({ status: ++polls < 2 ? "PROCESSING" : "AVAILABLE" }),
      [`POST ${L}/adAccounts/507/adCampaignGroups`]: () => ({ status: 201, body: {}, headers: { "x-restli-id": "601" } }),
      [`POST ${L}/adAccounts/507/adCampaigns`]: () => ({ status: 201, body: {}, headers: { "x-restli-id": "701" } }),
      [`POST ${L}/adAccounts/507/creatives`]: () => ({ value: { creative: "urn:li:sponsoredCreative:801" } }),
    });
    return { c: createLinkedInConnector({ clientId: "c", clientSecret: "s", apiVersion: "202606", fetch: api.fetchImpl, ...testDeps }), calls: api.calls };
  }

  it("uploads the video, then creates group → campaign → inline creative", async () => {
    const { c, calls } = make();
    const r = await c.launchCampaign(ctx, baseSpec);
    expect(r.platformIds).toMatchObject({
      videoUrn: "urn:li:video:V1",
      campaignGroupId: "urn:li:sponsoredCampaignGroup:601",
      campaignId: "urn:li:sponsoredCampaign:701",
      creativeId: "urn:li:sponsoredCreative:801",
    });
    const fin = calls.find((x) => x.url.search.includes("finalizeUpload"))!.body as { finalizeUploadRequest: { uploadedPartIds: string[] } };
    expect(fin.finalizeUploadRequest.uploadedPartIds).toEqual(["etag-1"]);
    const camp = calls.find((x) => x.path.endsWith("/adCampaigns"))!;
    expect(camp.headers["linkedin-version"]).toBe("202606");
    expect(camp.body).toMatchObject({
      format: "SINGLE_VIDEO",
      objectiveType: "WEBSITE_VISIT",
      dailyBudget: { amount: "500.00", currencyCode: "USD" },
      status: "PAUSED",
      targetingCriteria: { include: { and: [{ or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:102713980"] } }] } },
    });
    const cr = calls.find((x) => x.path.endsWith("/creatives"))!.body as { creative: { inlineContent: { post: Record<string, unknown> } } };
    expect(cr.creative.inlineContent.post).toMatchObject({ author: "urn:li:organization:42", contentLandingPage: "https://shop.example.com" });
  });
});

// ---------------------------------------------------------------- Pinterest
describe("Pinterest connector", () => {
  const P = "api.pinterest.com/v5";
  const ctx = { accessToken: "tok", adAccountId: "549", currency: "USD", pageId: "board1" };
  const bulk = (id: string) => ({ items: [{ data: { id } }] });

  function make(over: Parameters<typeof fakeApi>[0] = {}) {
    const api = fakeApi({
      "GET cdn.example.com/v.mp4": video,
      [`POST ${P}/media`]: () => ({ media_id: "m1", upload_url: "https://pinterest-media-upload.test/", upload_parameters: { key: "k", policy: "p" } }),
      "POST pinterest-media-upload.test/": () => ({ status: 204, raw: null }),
      [`GET ${P}/media/m1`]: () => ({ status: "succeeded" }),
      [`POST ${P}/pins`]: () => ({ id: "pin1" }),
      [`POST ${P}/ad_accounts/549/campaigns`]: () => bulk("c1"),
      [`POST ${P}/ad_accounts/549/ad_groups`]: () => bulk("g1"),
      [`POST ${P}/ad_accounts/549/ads`]: () => bulk("a1"),
      [`PATCH ${P}/ad_accounts/549/campaigns`]: () => bulk("c1"),
      ...over,
    });
    return { c: createPinterestConnector({ clientId: "c", clientSecret: "s", fetch: api.fetchImpl, ...testDeps }), calls: api.calls };
  }

  it("uploads video, creates a Pin and the ad hierarchy", async () => {
    const { c, calls } = make();
    const r = await c.launchCampaign(ctx, baseSpec);
    expect(r.platformIds).toMatchObject({ mediaId: "m1", pinId: "pin1", campaignId: "c1", adGroupId: "g1", adId: "a1" });
    const pin = calls.find((x) => x.path.endsWith("/pins"))!;
    expect(pin.url.searchParams.get("ad_account_id")).toBe("549");
    expect(pin.body).toMatchObject({ board_id: "board1", media_source: { source_type: "video_id", media_id: "m1" } });
    const g = (calls.find((x) => x.path.endsWith("/ad_groups"))!.body as Record<string, unknown>[])[0];
    expect(g).toMatchObject({ budget_in_micro_currency: 500_000_000, billable_event: "CLICKTHROUGH" });
    expect((g.targeting_spec as Record<string, string[]>).GEO).toEqual(["IN"]);
  });

  it("reports per-item errors and archives the campaign", async () => {
    const { c, calls } = make({ [`POST ${P}/ad_accounts/549/ads`]: () => ({ items: [{ exceptions: [{ message: "Pin not eligible" }] }] }) });
    await expect(c.launchCampaign(ctx, baseSpec)).rejects.toThrow("Pin not eligible");
    const arch = calls.filter((x) => x.method === "PATCH").at(-1)!.body as { status: string }[];
    expect(arch[0].status).toBe("ARCHIVED");
  });

  it("requires a cover image", async () => {
    const { c } = make();
    await expect(c.launchCampaign(ctx, { ...baseSpec, creative: { ...baseSpec.creative, thumbnailUrl: undefined } })).rejects.toThrow(/cover/);
  });
});

// ---------------------------------------------------------------- Snapchat
describe("Snapchat connector", () => {
  const S = "adsapi.snapchat.com/v1";
  const ctx = { accessToken: "tok", adAccountId: "acc1", currency: "USD", pageId: "profile1" };
  const wrap = (list: string, item: string, id: string) => ({ request_status: "SUCCESS", [list]: [{ sub_request_status: "SUCCESS", [item]: { id } }] });

  function make() {
    const api = fakeApi({
      "GET cdn.example.com/v.mp4": video,
      [`POST ${S}/adaccounts/acc1/media`]: () => wrap("media", "media", "med1"),
      [`POST ${S}/media/med1/upload`]: () => ({ request_status: "SUCCESS" }),
      [`GET ${S}/media/med1`]: () => ({ media: [{ media: { media_status: "READY" } }] }),
      [`POST ${S}/adaccounts/acc1/creatives`]: () => wrap("creatives", "creative", "cr1"),
      [`POST ${S}/adaccounts/acc1/campaigns`]: () => wrap("campaigns", "campaign", "c1"),
      [`POST ${S}/campaigns/c1/adsquads`]: () => wrap("adsquads", "adsquad", "sq1"),
      [`POST ${S}/adsquads/sq1/ads`]: () => wrap("ads", "ad", "ad1"),
      [`GET ${S}/campaigns/c1`]: () => ({ campaigns: [{ campaign: { id: "c1", name: "x", status: "PAUSED" } }] }),
      [`PUT ${S}/adaccounts/acc1/campaigns`]: () => ({ request_status: "SUCCESS" }),
    });
    return { c: createSnapchatConnector({ clientId: "c", clientSecret: "s", fetch: api.fetchImpl, ...testDeps }), calls: api.calls };
  }

  it("uploads media and creates creative → campaign → ad squad → ad", async () => {
    const { c, calls } = make();
    const r = await c.launchCampaign(ctx, { ...baseSpec, launchActive: true });
    expect(r).toMatchObject({ status: "ACTIVE", platformIds: { mediaId: "med1", creativeId: "cr1", campaignId: "c1", adSquadId: "sq1", adId: "ad1" } });
    const cr = (calls.find((x) => x.path.endsWith("/creatives"))!.body as { creatives: Record<string, unknown>[] }).creatives[0];
    expect(cr).toMatchObject({ profile_properties: { profile_id: "profile1" }, web_view_properties: { url: "https://shop.example.com" } });
    expect((cr.headline as string).length).toBeLessThanOrEqual(34);
    const sq = (calls.find((x) => x.path.endsWith("/adsquads"))!.body as { adsquads: Record<string, unknown>[] }).adsquads[0];
    expect(sq).toMatchObject({ daily_budget_micro: 500_000_000, optimization_goal: "SWIPES" });
    expect((sq.targeting as { geos: unknown[] }).geos).toEqual([{ country_code: "in" }]);
    const put = calls.find((x) => x.method === "PUT")!.body as { campaigns: { status: string }[] };
    expect(put.campaigns[0].status).toBe("ACTIVE");
  });
});
