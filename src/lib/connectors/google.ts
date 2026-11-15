import {
  ConnectorError,
  deps,
  type AccountContext,
  type AdAccount,
  type AdConnector,
  type CampaignSpec,
  type ConnectorDeps,
  type Insights,
  type LaunchResult,
  type TokenResult,
} from "./types";

/**
 * Google Ads connector (REST API).
 * Docs: https://developers.google.com/google-ads/api/rest/overview
 *
 * - No YouTube video ID → a Search campaign with a Responsive Search Ad + keywords.
 * - With a YouTube video ID → a Demand Gen campaign with a video responsive ad
 *   (runs on YouTube in-feed, in-stream and Shorts).
 *
 * The whole hierarchy is created in ONE googleAds:mutate request using temporary
 * resource names, so it either all succeeds or nothing is created.
 */

export interface GoogleConfig extends ConnectorDeps {
  clientId: string;
  clientSecret: string;
  developerToken: string;
  apiVersion: string; // e.g. "v25"
  /** Manager (MCC) account ID if client accounts are accessed through one. */
  loginCustomerId?: string;
}

export class GoogleAdsError extends ConnectorError {}

/** Google uses "micros": 1 unit of currency = 1,000,000 micros. */
export const toMicros = (amount: number) => Math.round(amount * 1_000_000);

const cid = (id: string) => id.replace(/^customers\//, "").replace(/-/g, "");

export function createGoogleConnector(config: GoogleConfig): AdConnector {
  const d = deps(config);
  const base = `https://googleads.googleapis.com/${config.apiVersion}`;

  async function oauthToken(params: Record<string, string>) {
    const res = await d.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new GoogleAdsError(String(json.error_description ?? json.error ?? "Google sign-in failed"));
    return json as { access_token: string; refresh_token?: string; expires_in?: number };
  }

  async function api<T = Record<string, unknown>>(
    method: "GET" | "POST",
    path: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": config.developerToken,
      "Content-Type": "application/json",
    };
    if (config.loginCustomerId) headers["login-customer-id"] = cid(config.loginCustomerId);
    const res = await d.fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error ?? {}) as { message?: string; details?: { errors?: { message?: string }[] }[] };
      const detail = err.details?.[0]?.errors?.[0]?.message;
      throw new GoogleAdsError(detail || err.message || `Google Ads API error (HTTP ${res.status})`, json);
    }
    return json as T;
  }

  const search = <T>(token: string, customerId: string, query: string) =>
    api<{ results?: T[] }>("POST", `/customers/${cid(customerId)}/googleAds:search`, token, { query });

  /** Country code → Google geo target constant (e.g. IN → geoTargetConstants/2356). */
  async function geoTargets(token: string, customerId: string, countries: string[]) {
    const list = countries.map((c) => `'${c.replace(/[^A-Z]/g, "")}'`).join(",");
    const res = await search<{ geoTargetConstant: { resourceName: string; countryCode: string } }>(
      token,
      customerId,
      `SELECT geo_target_constant.resource_name, geo_target_constant.country_code FROM geo_target_constant ` +
        `WHERE geo_target_constant.country_code IN (${list}) AND geo_target_constant.target_type = 'Country' ` +
        `AND geo_target_constant.status = 'ENABLED'`,
    );
    const found = (res.results ?? []).map((r) => r.geoTargetConstant.resourceName);
    if (found.length === 0) throw new GoogleAdsError(`Google Ads doesn't recognise these countries: ${countries.join(", ")}`);
    return found;
  }

  async function logoAsBase64(url: string) {
    const res = await d.fetch(url);
    if (!res.ok) throw new GoogleAdsError(`Could not download the logo image (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }

  return {
    platform: "google",
    label: "Google Ads (Search & YouTube)",
    pageLabel: null,

    getAuthUrl(state, redirectUri) {
      const p = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/userinfo.email",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },

    async exchangeCode(code, redirectUri): Promise<TokenResult> {
      const t = await oauthToken({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
      if (!t.refresh_token) throw new GoogleAdsError("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
      let displayName: string | null = null;
      try {
        const me = await d.fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${t.access_token}` },
        });
        displayName = ((await me.json()) as { email?: string }).email ?? null;
      } catch {
        /* optional */
      }
      return {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
        displayName,
      };
    },

    async refresh(refreshToken): Promise<TokenResult> {
      const t = await oauthToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
      return {
        accessToken: t.access_token,
        refreshToken,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
        displayName: null,
      };
    },

    async listAdAccounts(token): Promise<AdAccount[]> {
      const { resourceNames = [] } = await api<{ resourceNames?: string[] }>("GET", "/customers:listAccessibleCustomers", token);
      const accounts = await Promise.all(
        resourceNames.slice(0, 25).map(async (rn) => {
          try {
            const r = await search<{
              customer: { id: string; descriptiveName?: string; currencyCode: string; manager?: boolean; status?: string };
            }>(token, rn, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.status FROM customer LIMIT 1");
            const c = r.results?.[0]?.customer;
            if (!c || c.manager) return null; // manager accounts can't run ads themselves
            return {
              id: String(c.id),
              name: c.descriptiveName || `Google Ads ${c.id}`,
              currency: c.currencyCode,
              active: c.status === "ENABLED",
            };
          } catch {
            return null; // e.g. account only reachable through a manager
          }
        }),
      );
      return accounts.filter((a): a is AdAccount => a !== null);
    },

    async listPages() {
      return [];
    },

    async launchCampaign(ctx: AccountContext, spec: CampaignSpec): Promise<LaunchResult> {
      const c = spec.creative;
      const customer = cid(ctx.adAccountId);
      const rn = (type: string, id: number) => `customers/${customer}/${type}/${id}`;
      const geos = await geoTargets(ctx.accessToken, customer, spec.audience.countries);
      const isVideo = Boolean(c.youtubeVideoId);

      if (spec.objective === "video_views" && !isVideo) {
        throw new GoogleAdsError("For YouTube video ads, upload the video to YouTube and add its video ID.");
      }

      const headlines = [...new Set([c.headline.slice(0, 30), ...c.headlines])].filter(Boolean);
      const descriptions = [...new Set([...c.descriptions, c.primaryText.slice(0, 90)])].filter(Boolean);

      const budget = rn("campaignBudgets", -1);
      const campaign = rn("campaigns", -2);
      const adGroup = rn("adGroups", -3);
      const ops: Record<string, unknown>[] = [
        {
          campaignBudgetOperation: {
            create: {
              resourceName: budget,
              name: `${spec.name} budget ${Date.now()}`,
              amountMicros: String(toMicros(spec.dailyBudget)),
              deliveryMethod: "STANDARD",
              explicitlyShared: false,
            },
          },
        },
        {
          campaignOperation: {
            create: {
              resourceName: campaign,
              name: spec.name,
              status: spec.launchActive ? "ENABLED" : "PAUSED",
              advertisingChannelType: isVideo ? "DEMAND_GEN" : "SEARCH",
              campaignBudget: budget,
              targetSpend: {}, // "Maximize clicks"
              containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
              ...(isVideo
                ? {}
                : {
                    networkSettings: {
                      targetGoogleSearch: true,
                      targetSearchNetwork: true,
                      targetContentNetwork: false,
                      targetPartnerSearchNetwork: false,
                    },
                  }),
            },
          },
        },
        ...geos.map((geo) => ({
          campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: geo } } },
        })),
      ];

      if (isVideo) {
        if (!c.logoUrl) throw new GoogleAdsError("YouTube (Demand Gen) ads need a square logo image (logoUrl).");
        if (!c.businessName) throw new GoogleAdsError("YouTube (Demand Gen) ads need a business name.");
        const videoAsset = rn("assets", -4);
        const logoAsset = rn("assets", -5);
        ops.push(
          { assetOperation: { create: { resourceName: videoAsset, name: `${spec.name} video`, youtubeVideoAsset: { youtubeVideoId: c.youtubeVideoId } } } },
          { assetOperation: { create: { resourceName: logoAsset, name: `${spec.name} logo ${Date.now()}`, imageAsset: { data: await logoAsBase64(c.logoUrl) } } } },
          { adGroupOperation: { create: { resourceName: adGroup, campaign, name: `${spec.name} - Ad group`, status: "ENABLED" } } },
          {
            adGroupAdOperation: {
              create: {
                adGroup,
                status: "ENABLED",
                ad: {
                  name: `${spec.name} - Ad`,
                  finalUrls: [c.linkUrl],
                  demandGenVideoResponsiveAd: {
                    businessName: { text: c.businessName },
                    headlines: headlines.slice(0, 5).map((text) => ({ text })),
                    longHeadlines: [{ text: (c.longHeadline || c.headline).slice(0, 90) }],
                    descriptions: descriptions.slice(0, 5).map((text) => ({ text })),
                    videos: [{ asset: videoAsset }],
                    logoImages: [{ asset: logoAsset }],
                  },
                },
              },
            },
          },
        );
      } else {
        if (headlines.length < 3) throw new GoogleAdsError("Google Search ads need at least 3 short headlines (max 30 characters each).");
        if (descriptions.length < 2) throw new GoogleAdsError("Google Search ads need at least 2 descriptions (max 90 characters each).");
        if (c.keywords.length === 0) throw new GoogleAdsError("Google Search ads need at least one keyword.");
        ops.push(
          {
            adGroupOperation: {
              create: { resourceName: adGroup, campaign, name: `${spec.name} - Ad group`, status: "ENABLED", type: "SEARCH_STANDARD" },
            },
          },
          ...c.keywords.map((text) => ({
            adGroupCriterionOperation: { create: { adGroup, status: "ENABLED", keyword: { text, matchType: "BROAD" } } },
          })),
          {
            adGroupAdOperation: {
              create: {
                adGroup,
                status: "ENABLED",
                ad: {
                  finalUrls: [c.linkUrl],
                  responsiveSearchAd: {
                    headlines: headlines.slice(0, 15).map((text) => ({ text })),
                    descriptions: descriptions.slice(0, 4).map((text) => ({ text })),
                  },
                },
              },
            },
          },
        );
      }

      const res = await api<{ mutateOperationResponses: Record<string, { resourceName?: string }>[] }>(
        "POST",
        `/customers/${customer}/googleAds:mutate`,
        ctx.accessToken,
        { mutateOperations: ops, partialFailure: false },
      );
      const find = (key: string) => res.mutateOperationResponses.find((r) => r[key])?.[key]?.resourceName;
      const campaignRn = find("campaignResult");
      if (!campaignRn) throw new GoogleAdsError("Google Ads did not return the new campaign");
      return {
        platformIds: {
          campaignId: campaignRn,
          customerId: customer,
          budgetId: find("campaignBudgetResult") ?? "",
          adGroupId: find("adGroupResult") ?? "",
          adId: find("adGroupAdResult") ?? "",
          type: isVideo ? "DEMAND_GEN" : "SEARCH",
        },
        status: spec.launchActive ? "ACTIVE" : "PAUSED",
      };
    },

    async setStatus(ctx, platformIds, status) {
      const customer = cid(platformIds.customerId || ctx.adAccountId);
      await api("POST", `/customers/${customer}/campaigns:mutate`, ctx.accessToken, {
        operations: [
          {
            update: { resourceName: platformIds.campaignId, status: status === "ACTIVE" ? "ENABLED" : "PAUSED" },
            updateMask: "status",
          },
        ],
      });
    },

    async getInsights(ctx, platformIds): Promise<Insights> {
      const customer = cid(platformIds.customerId || ctx.adAccountId);
      const rnSafe = platformIds.campaignId.replace(/[^a-zA-Z0-9/~_-]/g, "");
      const res = await search<{ metrics?: Record<string, string | number> }>(
        ctx.accessToken,
        customer,
        `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc ` +
          `FROM campaign WHERE campaign.resource_name = '${rnSafe}'`,
      );
      const m = res.results?.[0]?.metrics ?? {};
      const n = (v: unknown) => Number(v ?? 0);
      return {
        spend: n(m.costMicros) / 1_000_000,
        impressions: n(m.impressions),
        reach: 0,
        clicks: n(m.clicks),
        ctr: n(m.ctr) * 100,
        cpc: n(m.averageCpc) / 1_000_000,
        videoViews: 0,
      };
    },
  };
}
