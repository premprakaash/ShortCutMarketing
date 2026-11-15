import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AdConnector } from "@/lib/connectors/types";

process.env.PGLITE_DIR = "memory";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const launched: { ctx: unknown; spec: unknown }[] = [];
let refreshCalls = 0;

function fakeConnector(platform: "meta" | "google", opts: { fail?: boolean } = {}): AdConnector {
  return {
    platform,
    label: platform,
    pageLabel: platform === "meta" ? "Facebook Page" : null,
    getAuthUrl: () => "",
    exchangeCode: async () => ({ accessToken: "t", expiresAt: null, displayName: "x" }),
    refresh: async (rt) => {
      refreshCalls++;
      expect(rt).toBe("refresh-secret");
      return { accessToken: "fresh-token", refreshToken: rt, expiresAt: new Date(Date.now() + 3600_000), displayName: null };
    },
    listAdAccounts: async () => [
      { id: "act_1", name: "Shop", currency: "INR", active: true },
      { id: "999", name: "Google Shop", currency: "INR", active: true },
    ],
    listPages: async () => [{ id: "p1", name: "Shop Page" }],
    launchCampaign: async (ctx, spec) => {
      if (opts.fail) throw new Error("Platform rejected the ad");
      launched.push({ ctx, spec });
      return { platformIds: { campaignId: `${platform}-c1` }, status: "PAUSED" };
    },
    setStatus: async () => {},
    getInsights: async () => ({ spend: 10, impressions: 100, reach: 90, clicks: 5, ctr: 5, cpc: 2, videoViews: 0 }),
  };
}

let googleFails = false;
vi.mock("@/lib/connectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/connectors")>()),
  getConnector: (p: string) => fakeConnector(p as "meta" | "google", { fail: p === "google" && googleFails }),
}));

const svc = await import("@/lib/service");
const { CampaignSpecSchema, MultiLaunchSchema } = await import("@/lib/connectors/types");

const shared = {
  name: "Test",
  objective: "video_views",
  audience: { countries: ["IN"] },
  creative: { videoUrl: "https://v/x.mp4", primaryText: "hi", headline: "h", linkUrl: "https://l" },
};
const spec = CampaignSpecSchema.parse({ ...shared, dailyBudget: 300 });

describe("service (embedded Postgres)", () => {
  let metaId: string;
  let googleId: string;

  beforeAll(async () => {
    metaId = await svc.saveConnection("user-a", "meta", { accessToken: "secret-token", expiresAt: null, displayName: "Prem" });
    googleId = await svc.saveConnection("user-a", "google", {
      accessToken: "old-token",
      refreshToken: "refresh-secret",
      expiresAt: new Date(Date.now() - 1000), // already expired → must refresh
      displayName: "prem@example.com",
    });
  });

  it("stores tokens encrypted and never returns them", async () => {
    const list = await svc.listConnections("user-a");
    expect(list).toHaveLength(2);
    for (const c of list) {
      expect(c).not.toHaveProperty("accessTokenEnc");
      expect(c).not.toHaveProperty("refreshTokenEnc");
    }
    expect(await svc.listConnections("user-b")).toEqual([]);
  });

  it("refuses to launch before an ad account is chosen", async () => {
    await expect(svc.launchCampaign("user-a", metaId, spec)).rejects.toThrow(/ad account/);
  });

  it("refreshes expired tokens automatically", async () => {
    await svc.selectAccount("user-a", googleId, "999", null);
    expect(refreshCalls).toBeGreaterThan(0);
    const before = refreshCalls;
    await svc.connectionOptions("user-a", googleId); // token now fresh → no second refresh
    expect(refreshCalls).toBe(before);
  });

  it("launches on several platforms with separate budgets", async () => {
    await svc.selectAccount("user-a", metaId, "act_1", "p1");
    const input = MultiLaunchSchema.parse({
      ...shared,
      targets: [
        { connectionId: metaId, dailyBudget: 300 },
        { connectionId: googleId, dailyBudget: 700 },
      ],
    });
    const { groupId, results } = await svc.launchMany("user-a", input);
    expect(results.every((r) => r.ok)).toBe(true);
    const budgets = launched.slice(-2).map((l) => (l.spec as { dailyBudget: number }).dailyBudget).sort();
    expect(budgets).toEqual([300, 700]);
    const googleCtx = launched.find((l) => (l.ctx as { adAccountId: string }).adAccountId === "999")!.ctx;
    expect(googleCtx).toMatchObject({ accessToken: "fresh-token" });

    const list = await svc.listCampaigns("user-a");
    expect(list.filter((c) => c.groupId === groupId)).toHaveLength(2);
    expect(list[0].insights?.spend).toBe(10);
  });

  it("reports each platform's failure separately", async () => {
    googleFails = true;
    const { results } = await svc.launchMany(
      "user-a",
      MultiLaunchSchema.parse({ ...shared, targets: [{ connectionId: metaId, dailyBudget: 100 }, { connectionId: googleId, dailyBudget: 100 }] }),
    );
    googleFails = false;
    expect(results.find((r) => r.platform === "meta")?.ok).toBe(true);
    expect(results.find((r) => r.platform === "google")).toMatchObject({ ok: false, error: "Platform rejected the ad" });
  });

  it("pauses and resumes", async () => {
    const [c] = await svc.listCampaigns("user-a", false);
    await svc.setCampaignStatus("user-a", c.id, "ACTIVE");
    expect((await svc.listCampaigns("user-a", false)).find((x) => x.id === c.id)?.status).toBe("ACTIVE");
  });

  it("keeps users isolated", async () => {
    await expect(svc.selectAccount("user-b", metaId, "act_1", null)).rejects.toThrow(/not found/);
    expect(await svc.listCampaigns("user-b")).toEqual([]);
    const { results } = await svc.launchMany("user-b", MultiLaunchSchema.parse({ ...shared, targets: [{ connectionId: metaId, dailyBudget: 1 }] }));
    expect(results[0]).toMatchObject({ ok: false, error: "Connection not found" });
  });

  it("rejects an ad account or page the login can't access", async () => {
    await expect(svc.selectAccount("user-a", metaId, "act_999", null)).rejects.toThrow(/isn't available/);
    await expect(svc.selectAccount("user-a", metaId, "act_1", "other-page")).rejects.toThrow(/facebook page/);
  });
});
