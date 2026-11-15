import { describe, expect, it } from "vitest";
import { createGoogleConnector, toMicros } from "@/lib/connectors/google";
import { baseSpec, fakeApi, testDeps } from "./helpers";

const H = "googleads.googleapis.com/v25";
const ctx = { accessToken: "tok", adAccountId: "123-456-7890", currency: "INR" };

function make(routes: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(routes);
  const c = createGoogleConnector({
    clientId: "cid",
    clientSecret: "sec",
    developerToken: "dev",
    apiVersion: "v25",
    loginCustomerId: "999-000-1111",
    fetch: api.fetchImpl,
    ...testDeps,
  });
  return { c, calls: api.calls };
}

const geo = () => ({ results: [{ geoTargetConstant: { resourceName: "geoTargetConstants/2356", countryCode: "IN" } }] });

describe("Google Ads connector", () => {
  it("converts to micros", () => expect(toMicros(500)).toBe(500_000_000));

  it("creates a Search campaign atomically in one mutate", async () => {
    let mutate: Record<string, unknown> = {};
    const { c, calls } = make({
      [`POST ${H}/customers/1234567890/googleAds:search`]: geo,
      [`POST ${H}/customers/1234567890/googleAds:mutate`]: ({ body }) => {
        mutate = body as Record<string, unknown>;
        return {
          mutateOperationResponses: [
            { campaignBudgetResult: { resourceName: "customers/1234567890/campaignBudgets/11" } },
            { campaignResult: { resourceName: "customers/1234567890/campaigns/22" } },
            { adGroupResult: { resourceName: "customers/1234567890/adGroups/33" } },
            { adGroupAdResult: { resourceName: "customers/1234567890/adGroupAds/33~44" } },
          ],
        };
      },
    });
    const r = await c.launchCampaign(ctx, baseSpec);
    expect(r.platformIds.campaignId).toBe("customers/1234567890/campaigns/22");
    expect(r.platformIds.type).toBe("SEARCH");
    expect(r.status).toBe("PAUSED");

    const ops = mutate.mutateOperations as Record<string, { create: Record<string, unknown> }>[];
    expect(mutate.partialFailure).toBe(false);
    expect(ops[0].campaignBudgetOperation.create.amountMicros).toBe("500000000");
    const camp = ops[1].campaignOperation.create;
    expect(camp).toMatchObject({ advertisingChannelType: "SEARCH", status: "PAUSED", campaignBudget: "customers/1234567890/campaignBudgets/-1" });
    expect(ops.some((o) => (o.campaignCriterionOperation?.create.location as { geoTargetConstant: string })?.geoTargetConstant === "geoTargetConstants/2356")).toBe(true);
    expect(ops.filter((o) => o.adGroupCriterionOperation)).toHaveLength(2);
    const rsa = ops.find((o) => o.adGroupAdOperation)!.adGroupAdOperation.create.ad as { responsiveSearchAd: { headlines: unknown[] } };
    expect(rsa.responsiveSearchAd.headlines.length).toBeGreaterThanOrEqual(3);

    // auth headers
    expect(calls[0].headers["developer-token"]).toBe("dev");
    expect(calls[0].headers["login-customer-id"]).toBe("9990001111");
    expect(calls[0].headers.authorization).toBe("Bearer tok");
  });

  it("creates a YouTube (Demand Gen) video campaign when a YouTube ID is given", async () => {
    let ops: Record<string, { create: Record<string, unknown> }>[] = [];
    const { c } = make({
      [`POST ${H}/customers/1234567890/googleAds:search`]: geo,
      "GET cdn.example.com/logo.png": () => ({ raw: new Uint8Array([1, 2, 3]) }),
      [`POST ${H}/customers/1234567890/googleAds:mutate`]: ({ body }) => {
        ops = (body as { mutateOperations: typeof ops }).mutateOperations;
        return { mutateOperationResponses: [{ campaignResult: { resourceName: "customers/1234567890/campaigns/9" } }] };
      },
    });
    const spec = {
      ...baseSpec,
      objective: "video_views" as const,
      creative: { ...baseSpec.creative, youtubeVideoId: "abc123", logoUrl: "https://cdn.example.com/logo.png" },
    };
    const r = await c.launchCampaign(ctx, spec);
    expect(r.platformIds.type).toBe("DEMAND_GEN");
    expect(ops[1].campaignOperation.create.advertisingChannelType).toBe("DEMAND_GEN");
    expect(ops.some((o) => (o.assetOperation?.create.youtubeVideoAsset as { youtubeVideoId: string })?.youtubeVideoId === "abc123")).toBe(true);
    const ad = ops.find((o) => o.adGroupAdOperation)!.adGroupAdOperation.create.ad as { demandGenVideoResponsiveAd: Record<string, unknown> };
    expect(ad.demandGenVideoResponsiveAd.businessName).toEqual({ text: "Sweet Co" });
  });

  it("explains what's missing for YouTube ads", async () => {
    const { c } = make({ [`POST ${H}/customers/1234567890/googleAds:search`]: geo });
    await expect(c.launchCampaign(ctx, { ...baseSpec, objective: "video_views" })).rejects.toThrow(/YouTube/);
    await expect(c.launchCampaign(ctx, { ...baseSpec, creative: { ...baseSpec.creative, keywords: [] } })).rejects.toThrow(/keyword/);
  });

  it("surfaces Google's error message", async () => {
    const { c } = make({
      [`POST ${H}/customers/1234567890/googleAds:search`]: geo,
      [`POST ${H}/customers/1234567890/googleAds:mutate`]: () => ({
        status: 400,
        body: { error: { message: "Request contains an invalid argument.", details: [{ errors: [{ message: "Budget too low" }] }] } },
      }),
    });
    await expect(c.launchCampaign(ctx, baseSpec)).rejects.toThrow("Budget too low");
  });

  it("lists non-manager accounts and reads insights", async () => {
    const { c } = make({
      [`GET ${H}/customers:listAccessibleCustomers`]: () => ({ resourceNames: ["customers/1", "customers/2"] }),
      [`POST ${H}/customers/1/googleAds:search`]: () => ({
        results: [{ customer: { id: "1", descriptiveName: "Shop", currencyCode: "INR", manager: false, status: "ENABLED" } }],
      }),
      [`POST ${H}/customers/2/googleAds:search`]: () => ({ results: [{ customer: { id: "2", currencyCode: "USD", manager: true } }] }),
      [`POST ${H}/customers/1234567890/googleAds:search`]: () => ({
        results: [{ metrics: { costMicros: "2500000", impressions: "1000", clicks: "50", ctr: 0.05, averageCpc: "50000" } }],
      }),
    });
    expect(await c.listAdAccounts("tok")).toEqual([{ id: "1", name: "Shop", currency: "INR", active: true }]);
    const ins = await c.getInsights(ctx, { campaignId: "customers/1234567890/campaigns/22", customerId: "1234567890" });
    expect(ins).toMatchObject({ spend: 2.5, impressions: 1000, clicks: 50, ctr: 5, cpc: 0.05 });
  });

  it("refreshes access tokens", async () => {
    const { c, calls } = make({ "POST oauth2.googleapis.com/token": () => ({ access_token: "new", expires_in: 3600 }) });
    const t = await c.refresh!("refresh-1");
    expect(t.accessToken).toBe("new");
    expect(t.refreshToken).toBe("refresh-1");
    expect((calls[0].body as Record<string, string>).grant_type).toBe("refresh_token");
  });
});
