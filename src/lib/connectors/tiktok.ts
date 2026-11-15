import {
  ageBuckets,
  ConnectorError,
  deps,
  pollUntil,
  type AccountContext,
  type AdAccount,
  type AdConnector,
  type CampaignSpec,
  type ConnectorDeps,
  type Insights,
  type LaunchResult,
  type Objective,
  type Page,
  type TokenResult,
} from "./types";

/**
 * TikTok Marketing API (v1.3).
 * Docs: https://business-api.tiktok.com/portal/docs
 *
 * Flow: upload video by URL → cover image → campaign → ad group → ad.
 * "Page" on TikTok = the identity the ad is posted as (stored as "TYPE:ID").
 */

export interface TikTokConfig extends ConnectorDeps {
  appId: string;
  secret: string;
}

export class TikTokError extends ConnectorError {}

/** TikTok targets countries by GeoNames location ID. */
export const TIKTOK_COUNTRY_IDS: Record<string, string> = {
  IN: "1269750",
  US: "6252001",
  GB: "2635167",
  AE: "290557",
  CA: "6251999",
  AU: "2077456",
  SG: "1880251",
  DE: "2921044",
  FR: "3017382",
  SA: "102358",
  ID: "1643084",
  MY: "1733045",
  PH: "1694008",
  TH: "1605651",
  VN: "1562822",
  JP: "1861060",
  BR: "3469034",
  MX: "3996063",
};

const OBJECTIVES: Record<Objective, { objective: string; goal: string; billing: string }> = {
  traffic: { objective: "TRAFFIC", goal: "CLICK", billing: "CPC" },
  awareness: { objective: "REACH", goal: "REACH", billing: "CPM" },
  video_views: { objective: "VIDEO_VIEWS", goal: "ENGAGED_VIEW", billing: "CPV" },
};

const AGE_GROUP: Record<string, string> = {
  "18-24": "AGE_18_24",
  "25-34": "AGE_25_34",
  "35-44": "AGE_35_44",
  "45-54": "AGE_45_54",
  "55-64": "AGE_55_100",
  "65-120": "AGE_55_100",
};

/** TikTok wants "YYYY-MM-DD HH:MM:SS" in UTC. */
const tiktokTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

export function createTikTokConnector(config: TikTokConfig): AdConnector {
  const d = deps(config);
  const base = "https://business-api.tiktok.com/open_api/v1.3";

  async function api<T = Record<string, unknown>>(
    method: "GET" | "POST",
    path: string,
    token: string | null,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Access-Token"] = token;
    let url = `${base}${path}`;
    if (method === "GET") {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) q.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      url += `?${q}`;
    }
    const res = await d.fetch(url, { method, headers, body: method === "POST" ? JSON.stringify(params) : undefined });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: T };
    if (!res.ok || json.code !== 0) {
      throw new TikTokError(json.message || `TikTok API error (HTTP ${res.status})`, json);
    }
    return json.data as T;
  }

  async function uploadCover(ctx: AccountContext, url: string) {
    const img = await api<{ image_id: string }>("POST", "/file/image/ad/upload/", ctx.accessToken, {
      advertiser_id: ctx.adAccountId,
      upload_type: "UPLOAD_BY_URL",
      image_url: url,
    });
    return img.image_id;
  }

  return {
    platform: "tiktok",
    label: "TikTok Ads",
    pageLabel: "TikTok identity",

    getAuthUrl(state, redirectUri) {
      const p = new URLSearchParams({ app_id: config.appId, state, redirect_uri: redirectUri });
      return `https://business-api.tiktok.com/portal/auth?${p}`;
    },

    async exchangeCode(code): Promise<TokenResult> {
      const t = await api<{ access_token: string }>("POST", "/oauth2/access_token/", null, {
        app_id: config.appId,
        secret: config.secret,
        auth_code: code,
      });
      // TikTok business tokens don't expire unless revoked.
      return { accessToken: t.access_token, expiresAt: null, displayName: "TikTok Business" };
    },

    async listAdAccounts(token): Promise<AdAccount[]> {
      const res = await api<{ list: { advertiser_id: string; advertiser_name: string }[] }>(
        "GET",
        "/oauth2/advertiser/get/",
        token,
        { app_id: config.appId, secret: config.secret },
      );
      if (res.list.length === 0) return [];
      const info = await api<{ list: { advertiser_id: string; name: string; currency: string; status: string }[] }>(
        "GET",
        "/advertiser/info/",
        token,
        { advertiser_ids: res.list.map((a) => a.advertiser_id), fields: ["advertiser_id", "name", "currency", "status"] },
      );
      return info.list.map((a) => ({
        id: a.advertiser_id,
        name: a.name,
        currency: a.currency,
        active: a.status === "STATUS_ENABLE",
      }));
    },

    async listPages(token, adAccountId): Promise<Page[]> {
      if (!adAccountId) return [];
      const res = await api<{ identity_list: { identity_id: string; identity_type: string; display_name: string }[] }>(
        "GET",
        "/identity/get/",
        token,
        { advertiser_id: adAccountId },
      );
      return res.identity_list.map((i) => ({
        id: `${i.identity_type}:${i.identity_id}`,
        name: `${i.display_name} (${i.identity_type === "CUSTOMIZED_USER" ? "custom" : "TikTok account"})`,
      }));
    },

    async launchCampaign(ctx: AccountContext, spec: CampaignSpec): Promise<LaunchResult> {
      if (!ctx.pageId) throw new TikTokError("Choose a TikTok identity for this ad account first.");
      const [identityType, identityId] = ctx.pageId.split(":");
      const locations = spec.audience.countries.map((c) => {
        const id = TIKTOK_COUNTRY_IDS[c];
        if (!id) throw new TikTokError(`TikTok targeting for country ${c} isn't set up yet.`);
        return id;
      });
      const map = OBJECTIVES[spec.objective];
      const a = spec.audience;
      const ids: Record<string, string> = {};

      // 1. Video + cover image
      const video = await api<{ video_id: string }[]>("POST", "/file/video/ad/upload/", ctx.accessToken, {
        advertiser_id: ctx.adAccountId,
        upload_type: "UPLOAD_BY_URL",
        video_url: spec.creative.videoUrl,
        file_name: `${spec.name}-${Date.now()}.mp4`.slice(0, 100),
      });
      ids.videoId = video[0].video_id;

      let coverUrl = spec.creative.thumbnailUrl;
      if (!coverUrl) {
        coverUrl = await pollUntil(
          d,
          async () => {
            const info = await api<{ list: { video_cover_url?: string }[] }>("GET", "/file/video/ad/info/", ctx.accessToken, {
              advertiser_id: ctx.adAccountId,
              video_ids: [ids.videoId],
            });
            return info.list[0]?.video_cover_url || undefined;
          },
          "TikTok to process the video",
        );
      }
      ids.imageId = await uploadCover(ctx, coverUrl);

      // 2. Campaign (disabled until everything exists)
      const campaign = await api<{ campaign_id: string }>("POST", "/campaign/create/", ctx.accessToken, {
        advertiser_id: ctx.adAccountId,
        campaign_name: spec.name,
        objective_type: map.objective,
        budget_mode: "BUDGET_MODE_INFINITE",
        operation_status: "DISABLE",
      });
      ids.campaignId = campaign.campaign_id;

      try {
        // 3. Ad group: budget, schedule, audience
        const start = spec.startTime ? new Date(spec.startTime) : new Date(Date.now() + 10 * 60_000);
        const adgroup = await api<{ adgroup_id: string }>("POST", "/adgroup/create/", ctx.accessToken, {
          advertiser_id: ctx.adAccountId,
          campaign_id: ids.campaignId,
          adgroup_name: `${spec.name} - Ad group`,
          promotion_type: "WEBSITE",
          placement_type: "PLACEMENT_TYPE_AUTOMATIC",
          location_ids: locations,
          age_groups: [...new Set(ageBuckets(a.ageMin, a.ageMax).map(([lo, hi]) => AGE_GROUP[`${lo}-${hi}`]))],
          gender: a.gender === "male" ? "GENDER_MALE" : a.gender === "female" ? "GENDER_FEMALE" : "GENDER_UNLIMITED",
          budget_mode: "BUDGET_MODE_DAY",
          budget: spec.dailyBudget,
          schedule_type: spec.endTime ? "SCHEDULE_START_END" : "SCHEDULE_FROM_NOW",
          schedule_start_time: tiktokTime(start),
          schedule_end_time: spec.endTime ? tiktokTime(new Date(spec.endTime)) : undefined,
          optimization_goal: map.goal,
          billing_event: map.billing,
          bid_type: "BID_TYPE_NO_BID",
          pacing: "PACING_MODE_SMOOTH",
          operation_status: "ENABLE",
        });
        ids.adGroupId = adgroup.adgroup_id;

        // 4. Ad
        const ad = await api<{ ad_ids: string[] }>("POST", "/ad/create/", ctx.accessToken, {
          advertiser_id: ctx.adAccountId,
          adgroup_id: ids.adGroupId,
          creatives: [
            {
              ad_name: `${spec.name} - Ad`,
              ad_format: "SINGLE_VIDEO",
              identity_type: identityType,
              identity_id: identityId,
              video_id: ids.videoId,
              image_ids: [ids.imageId],
              ad_text: spec.creative.primaryText.slice(0, 100),
              call_to_action: spec.creative.callToAction,
              landing_page_url: spec.creative.linkUrl,
              display_name: spec.creative.businessName,
            },
          ],
        });
        ids.adId = ad.ad_ids[0];

        if (spec.launchActive) {
          await api("POST", "/campaign/status/update/", ctx.accessToken, {
            advertiser_id: ctx.adAccountId,
            campaign_ids: [ids.campaignId],
            operation_status: "ENABLE",
          });
        }
        return { platformIds: ids as LaunchResult["platformIds"], status: spec.launchActive ? "ACTIVE" : "PAUSED" };
      } catch (err) {
        await api("POST", "/campaign/status/update/", ctx.accessToken, {
          advertiser_id: ctx.adAccountId,
          campaign_ids: [ids.campaignId],
          operation_status: "DELETE",
        }).catch(() => undefined);
        throw err;
      }
    },

    async setStatus(ctx, platformIds, status) {
      await api("POST", "/campaign/status/update/", ctx.accessToken, {
        advertiser_id: ctx.adAccountId,
        campaign_ids: [platformIds.campaignId],
        operation_status: status === "ACTIVE" ? "ENABLE" : "DISABLE",
      });
    },

    async getInsights(ctx, platformIds): Promise<Insights> {
      const end = new Date();
      const start = new Date(end.getTime() - 364 * 86_400_000); // TikTok allows up to 365 days
      const res = await api<{ list: { metrics: Record<string, string> }[] }>("GET", "/report/integrated/get/", ctx.accessToken, {
        advertiser_id: ctx.adAccountId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: ["campaign_id"],
        metrics: ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "video_play_actions"],
        filtering: [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify([platformIds.campaignId]) }],
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        page_size: 10,
      });
      const m = res.list[0]?.metrics ?? {};
      const n = (v: unknown) => Number(v ?? 0);
      return {
        spend: n(m.spend),
        impressions: n(m.impressions),
        reach: n(m.reach),
        clicks: n(m.clicks),
        ctr: n(m.ctr),
        cpc: n(m.cpc),
        videoViews: n(m.video_play_actions),
      };
    },
  };
}
