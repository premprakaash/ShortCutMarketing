import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AdConnector } from "@/lib/connectors/types";

process.env.PGLITE_DIR = "memory";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const launched: unknown[] = [];
const fake: AdConnector = {
  platform: "meta",
  label: "Fake",
  getAuthUrl: () => "",
  exchangeCode: async () => ({ accessToken: "t", expiresAt: null, displayName: "x" }),
  listAdAccounts: async (token) => {
    expect(token).toBe("secret-token"); // decrypted correctly
    return [{ id: "act_1", name: "Shop", currency: "INR", active: true }];
  },
  listPages: async () => [{ id: "p1", name: "Shop Page" }],
  launchCampaign: async (ctx, spec) => {
    launched.push({ ctx, spec });
    return { platformIds: { campaignId: "c1" }, status: "PAUSED" };
  },
  setStatus: async () => {},
  getInsights: async () => ({ spend: 10, impressions: 100, reach: 90, clicks: 5, ctr: 5, cpc: 2, videoViews: 0 }),
};

vi.mock("@/lib/connectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/connectors")>()),
  getConnector: () => fake,
}));

const svc = await import("@/lib/service");
const { CampaignSpecSchema } = await import("@/lib/connectors/types");

const spec = CampaignSpecSchema.parse({
  name: "Test",
  objective: "video_views",
  dailyBudget: 300,
  audience: { countries: ["IN"] },
  creative: { videoUrl: "https://v/x.mp4", primaryText: "hi", headline: "h", linkUrl: "https://l" },
});

describe("service (embedded Postgres)", () => {
  let connId: string;

  beforeAll(async () => {
    connId = await svc.saveConnection("user-a", "meta", {
      accessToken: "secret-token",
      expiresAt: null,
      displayName: "Prem",
    });
  });

  it("stores the token encrypted and never returns it", async () => {
    const [c] = await svc.listConnections("user-a");
    expect(c.id).toBe(connId);
    expect(c).not.toHaveProperty("accessTokenEnc");
    expect(await svc.listConnections("user-b")).toEqual([]);
  });

  it("refuses to launch before an ad account is chosen", async () => {
    await expect(svc.launchCampaign("user-a", connId, spec)).rejects.toThrow(/ad account/);
  });

  it("selects an account, launches and lists with stats", async () => {
    await svc.selectAccount("user-a", connId, "act_1", "p1");
    const camp = await svc.launchCampaign("user-a", connId, spec);
    expect(camp.status).toBe("PAUSED");
    expect(launched[0]).toMatchObject({ ctx: { adAccountId: "act_1", currency: "INR", pageId: "p1" } });

    const list = await svc.listCampaigns("user-a");
    expect(list).toHaveLength(1);
    expect(list[0].insights?.spend).toBe(10);

    await svc.setCampaignStatus("user-a", camp.id, "ACTIVE");
    expect((await svc.listCampaigns("user-a", false))[0].status).toBe("ACTIVE");
  });

  it("keeps users isolated", async () => {
    await expect(svc.selectAccount("user-b", connId, "act_1", null)).rejects.toThrow(/not found/);
    expect(await svc.listCampaigns("user-b")).toEqual([]);
  });

  it("rejects an ad account the login can't access", async () => {
    await expect(svc.selectAccount("user-a", connId, "act_999", null)).rejects.toThrow(/isn't available/);
  });
});
