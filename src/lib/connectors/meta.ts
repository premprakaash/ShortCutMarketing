import { createHmac } from "node:crypto";
import {
  ConnectorError,
  type AccountContext,
  type AdAccount,
  type AdConnector,
  type CampaignSpec,
  type Insights,
  type LaunchResult,
  type Objective,
  type Page,
  type TokenResult,
} from "./types";

/**
 * Meta (Facebook + Instagram) connector, built on the Marketing API.
 * Docs: https://developers.facebook.com/docs/marketing-api
 *
 * Launch flow: upload video → campaign → ad set → ad creative → ad.
 * The campaign is always created PAUSED and only switched to ACTIVE at the
 * very end, so a failure halfway can never leave a half-built ad spending money.
 */

export const META_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
];

/** Meta stores budgets in the currency's minor unit; these currencies have no minor unit. */
const ZERO_DECIMAL_CURRENCIES = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);

export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}

export function fromMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? amount : amount / 100;
}

const OBJECTIVE_MAP: Record<Objective, { objective: string; optimizationGoal: string; destinationType?: string }> = {
  traffic: { objective: "OUTCOME_TRAFFIC", optimizationGoal: "LINK_CLICKS", destinationType: "WEBSITE" },
  awareness: { objective: "OUTCOME_AWARENESS", optimizationGoal: "REACH" },
  video_views: { objective: "OUTCOME_ENGAGEMENT", optimizationGoal: "THRUPLAY", destinationType: "ON_VIDEO" },
};

export function actId(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

/** Translate our unified spec into Meta's ad set targeting object. */
export function buildTargeting(spec: CampaignSpec) {
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: spec.audience.countries },
    age_min: spec.audience.ageMin,
    age_max: spec.audience.ageMax,
    // Respect the exact age range chosen by the user instead of letting Advantage+ widen it.
    targeting_automation: { advantage_audience: 0 },
  };
  if (spec.audience.gender === "male") targeting.genders = [1];
  if (spec.audience.gender === "female") targeting.genders = [2];
  return targeting;
}

export interface MetaConfig {
  appId: string;
  appSecret: string;
  apiVersion: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for Meta to finish processing an uploaded video. */
  videoTimeoutMs?: number;
  videoPollMs?: number;
}

type Params = Record<string, unknown>;

export class MetaApiError extends ConnectorError {
  constructor(
    message: string,
    public readonly code?: number,
    details?: unknown,
  ) {
    super(message, details);
    this.name = "MetaApiError";
  }
}

export function createMetaConnector(config: MetaConfig): AdConnector {
  const doFetch = config.fetch ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = `https://graph.facebook.com/${config.apiVersion}`;

  const proof = (token: string) => createHmac("sha256", config.appSecret).update(token).digest("hex");

  function encode(params: Params): URLSearchParams {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      body.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    return body;
  }

  async function graph<T = Record<string, unknown>>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    token: string | null,
    params: Params = {},
  ): Promise<T> {
    const all: Params = { ...params };
    if (token) {
      all.access_token = token;
      all.appsecret_proof = proof(token);
    }
    const query = encode(all);
    const url = method === "POST" ? `${base}${path}` : `${base}${path}?${query}`;
    const res = await doFetch(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? query.toString() : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.error) {
      const e = (json.error ?? {}) as Record<string, unknown>;
      const msg = (e.error_user_msg as string) || (e.message as string) || `Meta API error (HTTP ${res.status})`;
      throw new MetaApiError(msg, e.code as number | undefined, e);
    }
    return json as T;
  }

  async function waitForVideo(token: string, videoId: string): Promise<void> {
    const timeout = config.videoTimeoutMs ?? 120_000;
    const every = config.videoPollMs ?? 3_000;
    const started = Date.now();
    for (;;) {
      const v = await graph<{ status?: { video_status?: string } }>("GET", `/${videoId}`, token, { fields: "status" });
      const s = v.status?.video_status;
      if (s === "ready") return;
      if (s === "error") throw new MetaApiError("Meta could not process this video. Check the format (MP4/MOV) and size.");
      if (Date.now() - started > timeout) {
        throw new MetaApiError("Timed out waiting for Meta to process the video. Try again in a minute.");
      }
      await sleep(every);
    }
  }

  async function pickThumbnail(token: string, videoId: string): Promise<string> {
    const res = await graph<{ data: { uri: string; is_preferred?: boolean }[] }>("GET", `/${videoId}/thumbnails`, token, {
      fields: "uri,is_preferred",
    });
    const thumb = res.data.find((t) => t.is_preferred) ?? res.data[0];
    if (!thumb) throw new MetaApiError("Meta did not return a thumbnail for this video; please supply thumbnailUrl.");
    return thumb.uri;
  }

  return {
    platform: "meta",
    label: "Meta (Facebook & Instagram)",

    getAuthUrl(state, redirectUri) {
      const p = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: redirectUri,
        state,
        response_type: "code",
        scope: META_SCOPES.join(","),
      });
      return `https://www.facebook.com/${config.apiVersion}/dialog/oauth?${p}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenResult> {
      const short = await graph<{ access_token: string }>("GET", "/oauth/access_token", null, {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: redirectUri,
        code,
      });
      // Swap for a long-lived (~60 day) token so campaigns can be managed later.
      const long = await graph<{ access_token: string; expires_in?: number }>("GET", "/oauth/access_token", null, {
        grant_type: "fb_exchange_token",
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: short.access_token,
      });
      const me = await graph<{ name?: string }>("GET", "/me", long.access_token, { fields: "name" });
      return {
        accessToken: long.access_token,
        expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
        displayName: me.name ?? null,
      };
    },

    async listAdAccounts(token): Promise<AdAccount[]> {
      const res = await graph<{ data: { id: string; name: string; currency: string; account_status: number }[] }>(
        "GET",
        "/me/adaccounts",
        token,
        { fields: "id,name,currency,account_status", limit: 100 },
      );
      // account_status 1 = ACTIVE
      return res.data.map((a) => ({ id: a.id, name: a.name, currency: a.currency, active: a.account_status === 1 }));
    },

    async listPages(token): Promise<Page[]> {
      const res = await graph<{ data: Page[] }>("GET", "/me/accounts", token, { fields: "id,name", limit: 100 });
      return res.data.map((p) => ({ id: p.id, name: p.name }));
    },

    async launchCampaign(ctx: AccountContext, spec: CampaignSpec): Promise<LaunchResult> {
      if (!ctx.pageId) throw new ConnectorError("Choose a Facebook Page for this account before launching ads.");
      const account = actId(ctx.adAccountId);
      const map = OBJECTIVE_MAP[spec.objective];
      const ids: Record<string, string> = {};

      // 1. Upload the video (Meta downloads it from the URL).
      const video = await graph<{ id: string }>("POST", `/${account}/advideos`, ctx.accessToken, {
        file_url: spec.creative.videoUrl,
        name: spec.name,
      });
      ids.videoId = video.id;

      try {
        // 2. Campaign — always PAUSED until every piece exists.
        const campaign = await graph<{ id: string }>("POST", `/${account}/campaigns`, ctx.accessToken, {
          name: spec.name,
          objective: map.objective,
          status: "PAUSED",
          buying_type: "AUCTION",
          special_ad_categories: [],
          is_adset_budget_sharing_enabled: false,
        });
        ids.campaignId = campaign.id;

        // 3. Ad set — budget, schedule and audience.
        const adSet = await graph<{ id: string }>("POST", `/${account}/adsets`, ctx.accessToken, {
          name: `${spec.name} - Ad set`,
          campaign_id: campaign.id,
          daily_budget: toMinorUnits(spec.dailyBudget, ctx.currency),
          billing_event: "IMPRESSIONS",
          optimization_goal: map.optimizationGoal,
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          destination_type: map.destinationType,
          targeting: buildTargeting(spec),
          start_time: spec.startTime,
          end_time: spec.endTime,
          status: "ACTIVE",
        });
        ids.adSetId = adSet.id;

        // 4. Creative — needs the video to be processed and a cover image.
        await waitForVideo(ctx.accessToken, video.id);
        const imageUrl = spec.creative.thumbnailUrl ?? (await pickThumbnail(ctx.accessToken, video.id));
        const creative = await graph<{ id: string }>("POST", `/${account}/adcreatives`, ctx.accessToken, {
          name: `${spec.name} - Creative`,
          object_story_spec: {
            page_id: ctx.pageId,
            video_data: {
              video_id: video.id,
              image_url: imageUrl,
              message: spec.creative.primaryText,
              title: spec.creative.headline,
              call_to_action: { type: spec.creative.callToAction, value: { link: spec.creative.linkUrl } },
            },
          },
        });
        ids.creativeId = creative.id;

        // 5. Ad.
        const ad = await graph<{ id: string }>("POST", `/${account}/ads`, ctx.accessToken, {
          name: `${spec.name} - Ad`,
          adset_id: adSet.id,
          creative: { creative_id: creative.id },
          status: "ACTIVE",
        });
        ids.adId = ad.id;

        // 6. Go live only when explicitly requested.
        if (spec.launchActive) {
          await graph("POST", `/${campaign.id}`, ctx.accessToken, { status: "ACTIVE" });
        }
        return { platformIds: ids as LaunchResult["platformIds"], status: spec.launchActive ? "ACTIVE" : "PAUSED" };
      } catch (err) {
        // Roll back so the customer's account isn't left with a broken, half-built campaign.
        if (ids.campaignId) {
          await graph("DELETE", `/${ids.campaignId}`, ctx.accessToken).catch(() => undefined);
        }
        throw err;
      }
    },

    async setStatus(ctx, platformIds, status) {
      await graph("POST", `/${platformIds.campaignId}`, ctx.accessToken, { status });
    },

    async getInsights(ctx, platformIds): Promise<Insights> {
      const res = await graph<{ data: Record<string, unknown>[] }>("GET", `/${platformIds.campaignId}/insights`, ctx.accessToken, {
        fields: "spend,impressions,reach,clicks,ctr,cpc,actions",
        date_preset: "maximum",
      });
      const row = res.data[0] ?? {};
      const num = (v: unknown) => (v === undefined || v === null ? 0 : Number(v));
      const actions = (row.actions as { action_type: string; value: string }[] | undefined) ?? [];
      return {
        spend: num(row.spend),
        impressions: num(row.impressions),
        reach: num(row.reach),
        clicks: num(row.clicks),
        ctr: num(row.ctr),
        cpc: num(row.cpc),
        videoViews: num(actions.find((a) => a.action_type === "video_view")?.value),
      };
    },
  };
}
