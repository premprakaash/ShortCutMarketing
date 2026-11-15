import {
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
 * Snapchat Marketing API (v1).
 * Docs: https://developers.snap.com/api/marketing-api/Ads-API
 *
 * Flow: create media → upload video → wait until READY → creative (with
 * public profile) → campaign → ad squad → ad.
 * "Page" on Snapchat = the brand's Public Profile (required on all ads).
 */

export interface SnapchatConfig extends ConnectorDeps {
  clientId: string;
  clientSecret: string;
}

export class SnapchatError extends ConnectorError {}

const OBJECTIVES: Record<Objective, { objective: string; goal: string }> = {
  traffic: { objective: "TRAFFIC", goal: "SWIPES" },
  awareness: { objective: "AWARENESS_AND_ENGAGEMENT", goal: "IMPRESSIONS" },
  video_views: { objective: "AWARENESS_AND_ENGAGEMENT", goal: "VIDEO_VIEWS" },
};

const CTA: Record<string, string> = {
  LEARN_MORE: "MORE",
  SHOP_NOW: "SHOP_NOW",
  SIGN_UP: "SIGN_UP",
  WATCH_MORE: "WATCH",
  CONTACT_US: "MORE",
  BOOK_NOW: "BOOK_NOW",
};

const micro = (amount: number) => Math.round(amount * 1_000_000);

export function createSnapchatConnector(config: SnapchatConfig): AdConnector {
  const d = deps(config);
  const base = "https://adsapi.snapchat.com/v1";

  async function api<T = Record<string, unknown>>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, token: string, body?: unknown) {
    const res = await d.fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.request_status === "ERROR") {
      throw new SnapchatError(String(json.debug_message ?? json.display_message ?? `Snapchat API error (HTTP ${res.status})`), json);
    }
    return json as T;
  }

  /** Snapchat wraps each created entity: { campaigns: [{ sub_request_status, campaign: {...} }] } */
  function created(res: Record<string, unknown>, list: string, item: string) {
    const entry = (res[list] as Record<string, unknown>[] | undefined)?.[0];
    const obj = entry?.[item] as { id?: string } | undefined;
    if (!obj?.id) throw new SnapchatError(String(entry?.sub_request_error_reason ?? `Snapchat could not create the ${item}`), res);
    return obj as Record<string, unknown> & { id: string };
  }

  async function oauth(params: Record<string, string>) {
    const res = await d.fetch("https://accounts.snapchat.com/login/oauth2/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new SnapchatError(String(json.error_description ?? "Snapchat sign-in failed"));
    return json as { access_token: string; refresh_token?: string; expires_in: number };
  }

  async function uploadVideo(ctx: AccountContext, name: string, url: string) {
    const media = created(
      await api("POST", `/adaccounts/${ctx.adAccountId}/media`, ctx.accessToken, {
        media: [{ name: `${name}-${Date.now()}`, type: "VIDEO", ad_account_id: ctx.adAccountId }],
      }),
      "media",
      "media",
    );
    const file = await downloadFile(d, url, 32 * 1024 * 1024);
    const form = new FormData();
    form.append("file", new Blob([file.bytes], { type: file.contentType }), "video.mp4");
    const up = await d.fetch(`${base}/media/${media.id}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
      body: form,
    });
    if (!up.ok) throw new SnapchatError(`Snapchat video upload failed (HTTP ${up.status}). Videos must be under 32 MB, 1080×1920.`);
    await pollUntil(
      d,
      async () => {
        const r = await api<{ media: { media: { media_status: string } }[] }>("GET", `/media/${media.id}`, ctx.accessToken);
        const status = r.media?.[0]?.media?.media_status;
        if (status === "FAILED") throw new SnapchatError("Snapchat could not process this video.");
        return status === "READY" ? true : undefined;
      },
      "Snapchat to process the video",
    );
    return media.id;
  }

  async function getCampaign(ctx: AccountContext, campaignId: string) {
    const r = await api<{ campaigns: { campaign: Record<string, unknown> }[] }>("GET", `/campaigns/${campaignId}`, ctx.accessToken);
    return r.campaigns[0].campaign;
  }

  async function updateCampaignStatus(ctx: AccountContext, campaignId: string, status: string) {
    const current = await getCampaign(ctx, campaignId);
    await api("PUT", `/adaccounts/${ctx.adAccountId}/campaigns`, ctx.accessToken, { campaigns: [{ ...current, status }] });
  }

  return {
    platform: "snapchat",
    label: "Snapchat Ads",
    pageLabel: "Public profile",

    getAuthUrl(state, redirectUri) {
      const p = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "snapchat-marketing-api",
        state,
      });
      return `https://accounts.snapchat.com/login/oauth2/authorize?${p}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenResult> {
      const t = await oauth({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      let displayName: string | null = null;
      try {
        const me = await api<{ me?: { display_name?: string; email?: string } }>("GET", "/me", t.access_token);
        displayName = me.me?.display_name ?? me.me?.email ?? null;
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
      const res = await api<{
        organizations: { organization: { ad_accounts?: { id: string; name: string; currency: string; status: string }[] } }[];
      }>("GET", "/me/organizations?with_ad_accounts=true", token);
      return res.organizations.flatMap((o) =>
        (o.organization.ad_accounts ?? []).map((a) => ({ id: a.id, name: a.name, currency: a.currency, active: a.status === "ACTIVE" })),
      );
    },

    async listPages(token, adAccountId): Promise<Page[]> {
      if (!adAccountId) return [];
      const acct = await api<{ adaccounts: { adaccount: { organization_id: string } }[] }>("GET", `/adaccounts/${adAccountId}`, token);
      const orgId = acct.adaccounts[0].adaccount.organization_id;
      const res = await api<{ public_profiles?: { public_profile: { id: string; display_name?: string; name?: string } }[] }>(
        "GET",
        `/organizations/${orgId}/public_profiles`,
        token,
      );
      return (res.public_profiles ?? []).map((p) => ({
        id: p.public_profile.id,
        name: p.public_profile.display_name ?? p.public_profile.name ?? p.public_profile.id,
      }));
    },

    async launchCampaign(ctx: AccountContext, spec: CampaignSpec): Promise<LaunchResult> {
      if (!ctx.pageId) throw new SnapchatError("Choose a Snapchat public profile first.");
      const c = spec.creative;
      const map = OBJECTIVES[spec.objective];
      const a = spec.audience;
      const ids: Record<string, string> = {};
      const start = spec.startTime ? new Date(spec.startTime) : new Date(Date.now() + 10 * 60_000);

      ids.mediaId = await uploadVideo(ctx, spec.name, c.videoUrl);

      ids.creativeId = created(
        await api("POST", `/adaccounts/${ctx.adAccountId}/creatives`, ctx.accessToken, {
          creatives: [
            {
              ad_account_id: ctx.adAccountId,
              name: `${spec.name} - Creative`,
              type: "WEB_VIEW",
              headline: c.headline.slice(0, 34),
              brand_name: (c.businessName ?? spec.name).slice(0, 25),
              shareable: true,
              call_to_action: CTA[c.callToAction] ?? "MORE",
              top_snap_media_id: ids.mediaId,
              web_view_properties: { url: c.linkUrl },
              profile_properties: { profile_id: ctx.pageId },
            },
          ],
        }),
        "creatives",
        "creative",
      ).id;

      ids.campaignId = created(
        await api("POST", `/adaccounts/${ctx.adAccountId}/campaigns`, ctx.accessToken, {
          campaigns: [
            {
              ad_account_id: ctx.adAccountId,
              name: spec.name,
              status: "PAUSED",
              start_time: start.toISOString(),
              ...(spec.endTime ? { end_time: spec.endTime } : {}),
              objective_v2_properties: { objective_v2_type: map.objective },
            },
          ],
        }),
        "campaigns",
        "campaign",
      ).id;

      try {
        ids.adSquadId = created(
          await api("POST", `/campaigns/${ids.campaignId}/adsquads`, ctx.accessToken, {
            adsquads: [
              {
                campaign_id: ids.campaignId,
                name: `${spec.name} - Ad squad`,
                type: "SNAP_ADS",
                status: "ACTIVE",
                placement_v2: { config: "AUTOMATIC" },
                billing_event: "IMPRESSION",
                auto_bid: true,
                optimization_goal: map.goal,
                daily_budget_micro: micro(spec.dailyBudget),
                delivery_constraint: "DAILY_BUDGET",
                start_time: start.toISOString(),
                ...(spec.endTime ? { end_time: spec.endTime } : {}),
                targeting: {
                  geos: a.countries.map((country_code) => ({ country_code: country_code.toLowerCase() })),
                  demographics: [
                    {
                      min_age: String(a.ageMin),
                      ...(a.ageMax < 65 ? { max_age: String(a.ageMax) } : {}),
                      ...(a.gender !== "all" ? { gender: a.gender === "male" ? "MALE" : "FEMALE" } : {}),
                    },
                  ],
                },
              },
            ],
          }),
          "adsquads",
          "adsquad",
        ).id;

        ids.adId = created(
          await api("POST", `/adsquads/${ids.adSquadId}/ads`, ctx.accessToken, {
            ads: [
              { ad_squad_id: ids.adSquadId, creative_id: ids.creativeId, name: `${spec.name} - Ad`, type: "REMOTE_WEBPAGE", status: "ACTIVE" },
            ],
          }),
          "ads",
          "ad",
        ).id;

        if (spec.launchActive) await updateCampaignStatus(ctx, ids.campaignId, "ACTIVE");
        return { platformIds: ids as LaunchResult["platformIds"], status: spec.launchActive ? "ACTIVE" : "PAUSED" };
      } catch (err) {
        await api("DELETE", `/campaigns/${ids.campaignId}`, ctx.accessToken).catch(() => undefined);
        throw err;
      }
    },

    async setStatus(ctx, platformIds, status) {
      await updateCampaignStatus(ctx, platformIds.campaignId, status);
    },

    async getInsights(ctx, platformIds): Promise<Insights> {
      const res = await api<{
        total_stats?: { total_stat: { stats: Record<string, number> } }[];
      }>("GET", `/campaigns/${platformIds.campaignId}/stats?granularity=TOTAL&fields=impressions,swipes,spend,video_views,uniques`, ctx.accessToken);
      const m = res.total_stats?.[0]?.total_stat?.stats ?? {};
      const n = (v: unknown) => Number(v ?? 0);
      const spend = n(m.spend) / 1_000_000;
      const clicks = n(m.swipes);
      const impressions = n(m.impressions);
      return {
        spend,
        impressions,
        reach: n(m.uniques),
        clicks,
        ctr: impressions ? (clicks / impressions) * 100 : 0,
        cpc: clicks ? spend / clicks : 0,
        videoViews: n(m.video_views),
      };
    },
  };
}
