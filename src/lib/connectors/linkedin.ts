import {
  ConnectorError,
  dateParts,
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
 * LinkedIn Marketing API (versioned /rest endpoints).
 * Docs: https://learn.microsoft.com/linkedin/marketing/
 *
 * Flow: upload video (Videos API) → campaign group → video campaign →
 * inline creative (a "dark" sponsored post that isn't shown to page followers).
 * "Page" on LinkedIn = the company page linked to the ad account.
 */

export interface LinkedInConfig extends ConnectorDeps {
  clientId: string;
  clientSecret: string;
  /** Marketing API version, YYYYMM. Versions are supported for ~1 year. */
  apiVersion: string;
}

export class LinkedInError extends ConnectorError {}

/** LinkedIn targets locations by geo URN. */
export const LINKEDIN_GEO: Record<string, string> = {
  IN: "urn:li:geo:102713980",
  US: "urn:li:geo:103644278",
  GB: "urn:li:geo:101165590",
  CA: "urn:li:geo:101174742",
  AE: "urn:li:geo:104305776",
  AU: "urn:li:geo:101452733",
  SG: "urn:li:geo:102454443",
  DE: "urn:li:geo:101282230",
  FR: "urn:li:geo:105015875",
};

const OBJECTIVES: Record<Objective, { objectiveType: string; costType: string; optimization: string }> = {
  traffic: { objectiveType: "WEBSITE_VISIT", costType: "CPM", optimization: "MAX_CLICK" },
  awareness: { objectiveType: "BRAND_AWARENESS", costType: "CPM", optimization: "MAX_REACH" },
  video_views: { objectiveType: "VIDEO_VIEW", costType: "CPV", optimization: "MAX_VIDEO_VIEW" },
};

const CTA: Record<string, string> = {
  LEARN_MORE: "LEARN_MORE",
  SHOP_NOW: "LEARN_MORE",
  SIGN_UP: "SIGN_UP",
  WATCH_MORE: "LEARN_MORE",
  CONTACT_US: "CONTACT_US",
  BOOK_NOW: "REGISTER",
};

const accountUrn = (id: string) => (id.startsWith("urn:") ? id : `urn:li:sponsoredAccount:${id}`);
const numericId = (urn: string) => urn.split(":").pop()!;

export function createLinkedInConnector(config: LinkedInConfig): AdConnector {
  const d = deps(config);
  const base = "https://api.linkedin.com/rest";

  async function api<T = Record<string, unknown>>(
    method: "GET" | "POST",
    path: string,
    token: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ data: T; id: string | null }> {
    const res = await d.fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "LinkedIn-Version": config.apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new LinkedInError(String(json.message ?? `LinkedIn API error (HTTP ${res.status})`), json);
    }
    return { data: json as T, id: res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") };
  }

  async function token(params: Record<string, string>) {
    const res = await d.fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new LinkedInError(String(json.error_description ?? "LinkedIn sign-in failed"));
    return json as { access_token: string; expires_in: number; refresh_token?: string };
  }

  async function uploadVideo(ctx: AccountContext, owner: string, url: string): Promise<string> {
    const file = await downloadFile(d, url, 200 * 1024 * 1024);
    const init = await api<{
      value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
    }>("POST", "/videos?action=initializeUpload", ctx.accessToken, {
      initializeUploadRequest: { owner, fileSizeBytes: file.bytes.byteLength, uploadCaptions: false, uploadThumbnail: false },
    });
    const { video, uploadToken, uploadInstructions } = init.data.value;
    const etags: string[] = [];
    for (const part of uploadInstructions) {
      const res = await d.fetch(part.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.bytes.slice(part.firstByte, part.lastByte + 1),
      });
      if (!res.ok) throw new LinkedInError(`LinkedIn video upload failed (HTTP ${res.status})`);
      etags.push(res.headers.get("etag") ?? "");
    }
    await api("POST", "/videos?action=finalizeUpload", ctx.accessToken, {
      finalizeUploadRequest: { video, uploadToken, uploadedPartIds: etags },
    });
    await pollUntil(
      d,
      async () => {
        const v = await api<{ status?: string }>("GET", `/videos/${encodeURIComponent(video)}`, ctx.accessToken);
        if (v.data.status === "PROCESSING_FAILED") throw new LinkedInError("LinkedIn could not process this video.");
        return v.data.status === "AVAILABLE" ? true : undefined;
      },
      "LinkedIn to process the video",
    );
    return video;
  }

  async function setCampaignStatus(ctx: AccountContext, platformIds: Record<string, string>, status: string) {
    await api(
      "POST",
      `/adAccounts/${numericId(accountUrn(ctx.adAccountId))}/adCampaigns/${numericId(platformIds.campaignId)}`,
      ctx.accessToken,
      { patch: { $set: { status } } },
      { "X-RestLi-Method": "PARTIAL_UPDATE" },
    );
  }

  return {
    platform: "linkedin",
    label: "LinkedIn Ads",
    pageLabel: "Company page",

    getAuthUrl(state, redirectUri) {
      const p = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        state,
        scope: "r_ads rw_ads r_ads_reporting r_basicprofile",
      });
      return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenResult> {
      const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      return {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? null,
        expiresAt: new Date(Date.now() + t.expires_in * 1000),
        displayName: "LinkedIn",
      };
    },

    async refresh(refreshToken): Promise<TokenResult> {
      const t = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
      return {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? refreshToken,
        expiresAt: new Date(Date.now() + t.expires_in * 1000),
        displayName: null,
      };
    },

    async listAdAccounts(tok): Promise<AdAccount[]> {
      const res = await api<{ elements: { id: number; name: string; currency: string; status: string }[] }>(
        "GET",
        "/adAccounts?q=search&search=(status:(values:List(ACTIVE,DRAFT)))",
        tok,
      );
      return res.data.elements.map((a) => ({ id: String(a.id), name: a.name, currency: a.currency, active: a.status === "ACTIVE" }));
    },

    async listPages(tok, adAccountId): Promise<Page[]> {
      if (!adAccountId) return [];
      const res = await api<{ reference?: string; name: string }>("GET", `/adAccounts/${numericId(adAccountId)}`, tok);
      const ref = res.data.reference;
      if (!ref || !ref.startsWith("urn:li:organization:")) return [];
      return [{ id: ref, name: `Company page linked to ${res.data.name}` }];
    },

    async launchCampaign(ctx: AccountContext, spec: CampaignSpec): Promise<LaunchResult> {
      if (!ctx.pageId) throw new LinkedInError("This LinkedIn ad account needs a linked company page.");
      const geos = spec.audience.countries.map((c) => {
        const g = LINKEDIN_GEO[c];
        if (!g) throw new LinkedInError(`LinkedIn targeting for country ${c} isn't set up yet.`);
        return g;
      });
      const map = OBJECTIVES[spec.objective];
      const account = accountUrn(ctx.adAccountId);
      const accountId = numericId(account);
      const money = (amount: number) => ({ amount: amount.toFixed(2), currencyCode: ctx.currency });
      const start = spec.startTime ? new Date(spec.startTime) : new Date(Date.now() + 10 * 60_000);
      const runSchedule = { start: start.getTime(), ...(spec.endTime ? { end: new Date(spec.endTime).getTime() } : {}) };
      const ids: Record<string, string> = {};

      ids.videoUrn = await uploadVideo(ctx, ctx.pageId, spec.creative.videoUrl);

      const group = await api("POST", `/adAccounts/${accountId}/adCampaignGroups`, ctx.accessToken, {
        account,
        name: spec.name,
        status: "ACTIVE",
        runSchedule,
      });
      ids.campaignGroupId = `urn:li:sponsoredCampaignGroup:${group.id}`;

      try {
        const campaign = await api("POST", `/adAccounts/${accountId}/adCampaigns`, ctx.accessToken, {
          account,
          campaignGroup: ids.campaignGroupId,
          name: spec.name,
          type: "SPONSORED_UPDATES",
          format: "SINGLE_VIDEO",
          objectiveType: map.objectiveType,
          costType: map.costType,
          optimizationTargetType: map.optimization,
          dailyBudget: money(spec.dailyBudget),
          locale: { country: "US", language: "en" },
          offsiteDeliveryEnabled: false,
          audienceExpansionEnabled: false,
          runSchedule,
          status: "PAUSED",
          targetingCriteria: {
            include: { and: [{ or: { "urn:li:adTargetingFacet:locations": geos } }] },
          },
        });
        ids.campaignId = `urn:li:sponsoredCampaign:${campaign.id}`;

        const creative = await api("POST", `/adAccounts/${accountId}/creatives?action=createInline`, ctx.accessToken, {
          creative: {
            campaign: ids.campaignId,
            intendedStatus: "ACTIVE",
            inlineContent: {
              post: {
                adContext: { dscAdAccount: account, dscStatus: "ACTIVE" },
                author: ctx.pageId,
                commentary: spec.creative.primaryText.slice(0, 600),
                visibility: "PUBLIC",
                lifecycleState: "PUBLISHED",
                isReshareDisabledByAuthor: true,
                contentLandingPage: spec.creative.linkUrl,
                contentCallToActionLabel: CTA[spec.creative.callToAction] ?? "LEARN_MORE",
                content: { media: { title: spec.creative.headline.slice(0, 200), id: ids.videoUrn } },
              },
            },
          },
        });
        const created = creative.data as { value?: { creative?: string } };
        ids.creativeId = created.value?.creative ?? creative.id ?? "";

        if (spec.launchActive) await setCampaignStatus(ctx, ids, "ACTIVE");
        return { platformIds: ids as LaunchResult["platformIds"], status: spec.launchActive ? "ACTIVE" : "PAUSED" };
      } catch (err) {
        await api(
          "POST",
          `/adAccounts/${accountId}/adCampaignGroups/${numericId(ids.campaignGroupId)}`,
          ctx.accessToken,
          { patch: { $set: { status: "ARCHIVED" } } },
          { "X-RestLi-Method": "PARTIAL_UPDATE" },
        ).catch(() => undefined);
        throw err;
      }
    },

    async setStatus(ctx, platformIds, status) {
      await setCampaignStatus(ctx, platformIds, status);
    },

    async getInsights(ctx, platformIds): Promise<Insights> {
      const s = dateParts(new Date(Date.now() - 365 * 86_400_000));
      const q =
        `/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL` +
        `&dateRange=(start:(year:${s.year},month:${s.month},day:${s.day}))` +
        `&campaigns=List(${encodeURIComponent(platformIds.campaignId)})` +
        `&fields=costInLocalCurrency,impressions,clicks,videoViews,approximateMemberReach`;
      const res = await api<{ elements: Record<string, string | number>[] }>("GET", q, ctx.accessToken);
      const m = res.data.elements[0] ?? {};
      const n = (v: unknown) => Number(v ?? 0);
      const clicks = n(m.clicks);
      const impressions = n(m.impressions);
      const spend = n(m.costInLocalCurrency);
      return {
        spend,
        impressions,
        reach: n(m.approximateMemberReach),
        clicks,
        ctr: impressions ? (clicks / impressions) * 100 : 0,
        cpc: clicks ? spend / clicks : 0,
        videoViews: n(m.videoViews),
      };
    },
  };
}
