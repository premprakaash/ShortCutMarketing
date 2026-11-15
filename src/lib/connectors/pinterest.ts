import {
  ageBuckets,
  ConnectorError,
  deps,
  downloadFile,
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
 * Pinterest API v5.
 * Docs: https://developers.pinterest.com/docs/api/v5/
 *
 * Flow: register media → upload video to Pinterest's storage → wait →
 * create video Pin on a board → campaign → ad group → ad.
 * "Page" on Pinterest = the board the Pin is saved to.
 */

export interface PinterestConfig extends ConnectorDeps {
  clientId: string;
  clientSecret: string;
}

export class PinterestError extends ConnectorError {}

const OBJECTIVES: Record<Objective, { objective: string; billable: string }> = {
  traffic: { objective: "CONSIDERATION", billable: "CLICKTHROUGH" },
  awareness: { objective: "AWARENESS", billable: "IMPRESSION" },
  video_views: { objective: "VIDEO_VIEW", billable: "VIDEO_V_50_MRC" },
};

const AGE: Record<string, string[]> = {
  "18-24": ["18-24"],
  "25-34": ["25-34"],
  "35-44": ["35-44"],
  "45-54": ["45-49", "50-54"],
  "55-64": ["55-64"],
  "65-120": ["65+"],
};

const micro = (amount: number) => Math.round(amount * 1_000_000);

type BulkResult = { items: { data?: { id: string }; exceptions?: { message?: string }[] }[] };

export function createPinterestConnector(config: PinterestConfig): AdConnector {
  const d = deps(config);
  const base = "https://api.pinterest.com/v5";

  async function api<T = Record<string, unknown>>(method: "GET" | "POST" | "PATCH", path: string, token: string, body?: unknown) {
    const res = await d.fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new PinterestError(String(json.message ?? `Pinterest API error (HTTP ${res.status})`), json);
    return json as T;
  }

  /** Bulk endpoints return per-item errors with HTTP 200. */
  function firstId(res: BulkResult, what: string) {
    const item = res.items?.[0];
    if (!item?.data?.id) throw new PinterestError(item?.exceptions?.[0]?.message ?? `Pinterest could not create the ${what}`, res);
    return item.data.id;
  }

  async function oauth(params: Record<string, string>) {
    const res = await d.fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new PinterestError(String(json.message ?? "Pinterest sign-in failed"));
    return json as { access_token: string; refresh_token?: string; expires_in: number };
  }

  async function uploadVideo(token: string, url: string) {
    const file = await downloadFile(d, url, 2 * 1024 * 1024 * 1024);
    const reg = await api<{ media_id: string; upload_url: string; upload_parameters: Record<string, string> }>(
      "POST",
      "/media",
      token,
      { media_type: "video" },
    );
    const form = new FormData();
    for (const [k, v] of Object.entries(reg.upload_parameters)) form.append(k, v);
    form.append("file", new Blob([file.bytes], { type: file.contentType }), "video.mp4");
    const up = await d.fetch(reg.upload_url, { method: "POST", body: form });
    if (!up.ok) throw new PinterestError(`Pinterest video upload failed (HTTP ${up.status})`);
    await pollUntil(
      d,
      async () => {
        const m = await api<{ status: string }>("GET", `/media/${reg.media_id}`, token);
        if (m.status === "failed") throw new PinterestError("Pinterest could not process this video.");
        return m.status === "succeeded" ? true : undefined;
      },
      "Pinterest to process the video",
    );
    return reg.media_id;
  }

  return {
    platform: "pinterest",
    label: "Pinterest Ads",
    pageLabel: "Board",

    getAuthUrl(state, redirectUri) {
      const p = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "ads:read,ads:write,boards:read,boards:write,pins:read,pins:write,user_accounts:read",
        state,
      });
      return `https://www.pinterest.com/oauth/?${p}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenResult> {
      const t = await oauth({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      let displayName: string | null = null;
      try {
        displayName = (await api<{ username?: string }>("GET", "/user_account", t.access_token)).username ?? null;
      } catch {
        /* optional */
      }
      return {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? null,
        expiresAt: new Date(Date.now() + t.expires_in * 1000),
        displayName,
      };
    },

    async refresh(refreshToken): Promise<TokenResult> {
      const t = await oauth({ grant_type: "refresh_token", refresh_token: refreshToken });
      return {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? refreshToken,
        expiresAt: new Date(Date.now() + t.expires_in * 1000),
        displayName: null,
      };
    },

    async listAdAccounts(token): Promise<AdAccount[]> {
      const res = await api<{ items: { id: string; name: string; currency: string }[] }>("GET", "/ad_accounts?page_size=100", token);
      return res.items.map((a) => ({ id: a.id, name: a.name, currency: a.currency, active: true }));
    },

    async listPages(token): Promise<Page[]> {
      const res = await api<{ items: { id: string; name: string }[] }>("GET", "/boards?page_size=100", token);
      return res.items.map((b) => ({ id: b.id, name: b.name }));
    },

    async launchCampaign(ctx: AccountContext, spec: CampaignSpec): Promise<LaunchResult> {
      if (!ctx.pageId) throw new PinterestError("Choose a Pinterest board first.");
      const c = spec.creative;
      if (!c.thumbnailUrl) throw new PinterestError("Pinterest video Pins need a cover image (thumbnailUrl).");
      const map = OBJECTIVES[spec.objective];
      const a = spec.audience;
      const ids: Record<string, string> = {};
      const acct = ctx.adAccountId;

      ids.mediaId = await uploadVideo(ctx.accessToken, c.videoUrl);

      const pin = await api<{ id: string }>("POST", `/pins?ad_account_id=${acct}`, ctx.accessToken, {
        board_id: ctx.pageId,
        title: c.headline.slice(0, 100),
        description: c.primaryText.slice(0, 500),
        link: c.linkUrl,
        media_source: { source_type: "video_id", media_id: ids.mediaId, cover_image_url: c.thumbnailUrl },
      });
      ids.pinId = pin.id;

      ids.campaignId = firstId(
        await api<BulkResult>("POST", `/ad_accounts/${acct}/campaigns`, ctx.accessToken, [
          { ad_account_id: acct, name: spec.name, status: "PAUSED", objective_type: map.objective },
        ]),
        "campaign",
      );

      try {
        const start = spec.startTime ? new Date(spec.startTime) : new Date();
        const gender = a.gender === "all" ? ["female", "male", "unisex"] : [a.gender];
        ids.adGroupId = firstId(
          await api<BulkResult>("POST", `/ad_accounts/${acct}/ad_groups`, ctx.accessToken, [
            {
              ad_account_id: acct,
              campaign_id: ids.campaignId,
              name: `${spec.name} - Ad group`,
              status: "ACTIVE",
              budget_type: "DAILY",
              budget_in_micro_currency: micro(spec.dailyBudget),
              bid_strategy_type: "AUTOMATIC_BID",
              billable_event: map.billable,
              auto_targeting_enabled: true,
              start_time: Math.floor(start.getTime() / 1000),
              ...(spec.endTime ? { end_time: Math.floor(new Date(spec.endTime).getTime() / 1000) } : {}),
              targeting_spec: {
                GEO: a.countries,
                AGE_BUCKET: ageBuckets(a.ageMin, a.ageMax).flatMap(([lo, hi]) => AGE[`${lo}-${hi}`]),
                GENDER: gender,
              },
            },
          ]),
          "ad group",
        );
        ids.adId = firstId(
          await api<BulkResult>("POST", `/ad_accounts/${acct}/ads`, ctx.accessToken, [
            {
              ad_group_id: ids.adGroupId,
              creative_type: "VIDEO",
              pin_id: ids.pinId,
              name: `${spec.name} - Ad`,
              status: "ACTIVE",
            },
          ]),
          "ad",
        );
        if (spec.launchActive) {
          await api("PATCH", `/ad_accounts/${acct}/campaigns`, ctx.accessToken, [{ id: ids.campaignId, status: "ACTIVE" }]);
        }
        return { platformIds: ids as LaunchResult["platformIds"], status: spec.launchActive ? "ACTIVE" : "PAUSED" };
      } catch (err) {
        await api("PATCH", `/ad_accounts/${acct}/campaigns`, ctx.accessToken, [{ id: ids.campaignId, status: "ARCHIVED" }]).catch(
          () => undefined,
        );
        throw err;
      }
    },

    async setStatus(ctx, platformIds, status) {
      await api("PATCH", `/ad_accounts/${ctx.adAccountId}/campaigns`, ctx.accessToken, [{ id: platformIds.campaignId, status }]);
    },

    async getInsights(ctx, platformIds): Promise<Insights> {
      const end = new Date();
      const start = new Date(end.getTime() - 89 * 86_400_000); // Pinterest reports up to 90 days per call
      const q = new URLSearchParams({
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        campaign_ids: platformIds.campaignId,
        columns: "SPEND_IN_DOLLAR,TOTAL_IMPRESSION,TOTAL_CLICKTHROUGH,CTR,CPC_IN_MICRO_DOLLAR,TOTAL_VIDEO_3SEC_VIEWS",
        granularity: "TOTAL",
      });
      const rows = await api<Record<string, number>[]>("GET", `/ad_accounts/${ctx.adAccountId}/campaigns/analytics?${q}`, ctx.accessToken);
      const m = rows[0] ?? {};
      const n = (v: unknown) => Number(v ?? 0);
      return {
        spend: n(m.SPEND_IN_DOLLAR),
        impressions: n(m.TOTAL_IMPRESSION),
        reach: 0,
        clicks: n(m.TOTAL_CLICKTHROUGH),
        ctr: n(m.CTR) * 100,
        cpc: n(m.CPC_IN_MICRO_DOLLAR) / 1_000_000,
        videoViews: n(m.TOTAL_VIDEO_3SEC_VIEWS),
      };
    },
  };
}
