import { z } from "zod";

/**
 * One campaign format for every platform. Each connector translates this
 * spec into its platform's own structure (Meta: campaign → ad set → ad,
 * Google: budget → campaign → ad group → ad, TikTok: campaign → ad group → ad, ...).
 */

export const PLATFORMS = ["meta", "google", "tiktok", "linkedin", "pinterest", "snapchat"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const OBJECTIVES = ["traffic", "awareness", "video_views"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const CALL_TO_ACTIONS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WATCH_MORE", "CONTACT_US", "BOOK_NOW"] as const;
export type CallToAction = (typeof CALL_TO_ACTIONS)[number];

export const CreativeSchema = z.object({
  /** Public MP4/MOV link. Used by Meta, TikTok, LinkedIn, Pinterest, Snapchat. */
  videoUrl: z.url(),
  /** Optional cover image. If missing, the platform's generated thumbnail is used where possible. */
  thumbnailUrl: z.url().optional(),
  /** Main ad text. */
  primaryText: z.string().trim().min(1).max(2000),
  /** Main headline (kept short so it fits every platform). */
  headline: z.string().trim().min(1).max(255),
  /** Extra short headlines (≤30 chars) — Google needs 3+. */
  headlines: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
  /** Descriptions (≤90 chars) — Google needs 2+. */
  descriptions: z.array(z.string().trim().min(1).max(90)).max(5).default([]),
  /** Long headline (≤90 chars) — Google Demand Gen. */
  longHeadline: z.string().trim().max(90).optional(),
  /** Brand / business name (≤25 chars works everywhere). */
  businessName: z.string().trim().max(25).optional(),
  /** Square logo image URL — Google Demand Gen. */
  logoUrl: z.url().optional(),
  /** YouTube video ID — Google needs videos hosted on YouTube. */
  youtubeVideoId: z.string().trim().max(20).optional(),
  /** Search keywords — Google Search. */
  keywords: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  linkUrl: z.url(),
  callToAction: z.enum(CALL_TO_ACTIONS).default("LEARN_MORE"),
});

export const AudienceSchema = z.object({
  /** ISO 3166-1 alpha-2 country codes, e.g. ["IN"] */
  countries: z.array(z.string().length(2).toUpperCase()).min(1),
  ageMin: z.number().int().min(18).max(65).default(18),
  ageMax: z.number().int().min(18).max(65).default(65),
  gender: z.enum(["all", "male", "female"]).default("all"),
});

const baseSpec = {
  name: z.string().trim().min(1).max(200),
  objective: z.enum(OBJECTIVES),
  startTime: z.iso.datetime({ offset: true }).optional(),
  endTime: z.iso.datetime({ offset: true }).optional(),
  audience: AudienceSchema,
  creative: CreativeSchema,
  /** Safety default: everything is created PAUSED unless this is true. */
  launchActive: z.boolean().default(false),
};

type Refinable = z.ZodType<{
  audience: { ageMin: number; ageMax: number };
  startTime?: string;
  endTime?: string;
}>;

function withChecks<T extends Refinable>(schema: T) {
  return schema
    .refine((s) => s.audience.ageMin <= s.audience.ageMax, {
      message: "audience.ageMin must be ≤ audience.ageMax",
      path: ["audience", "ageMin"],
    })
    .refine((s) => !s.startTime || !s.endTime || new Date(s.startTime) < new Date(s.endTime), {
      message: "endTime must be after startTime",
      path: ["endTime"],
    });
}

/** Spec for one platform: includes that platform's daily budget. */
export const CampaignSpecSchema = withChecks(
  z.object({
    ...baseSpec,
    /** Daily budget in major currency units (e.g. 500 means ₹500/day). */
    dailyBudget: z.number().positive(),
  }),
);
export type CampaignSpec = z.infer<typeof CampaignSpecSchema>;

/** Launch on several platforms at once: shared spec + per-account budgets. */
export const MultiLaunchSchema = withChecks(
  z.object({
    ...baseSpec,
    targets: z
      .array(z.object({ connectionId: z.string().min(1), dailyBudget: z.number().positive() }))
      .min(1, "Choose at least one ad account"),
  }),
);
export type MultiLaunch = z.infer<typeof MultiLaunchSchema>;

export interface AdAccount {
  id: string;
  name: string;
  currency: string;
  active: boolean;
}

export interface Page {
  id: string;
  name: string;
}

export interface TokenResult {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
  displayName: string | null;
}

/** Everything a connector needs to act on one customer's ad account. */
export interface AccountContext {
  accessToken: string;
  adAccountId: string;
  currency: string;
  pageId?: string | null;
}

export interface LaunchResult {
  /** Platform object IDs, e.g. { campaignId, adSetId, creativeId, adId, videoId } */
  platformIds: Record<string, string> & { campaignId: string };
  status: "ACTIVE" | "PAUSED";
}

export interface Insights {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  videoViews: number;
}

export const EMPTY_INSIGHTS: Insights = { spend: 0, impressions: 0, reach: 0, clicks: 0, ctr: 0, cpc: 0, videoViews: 0 };

export interface AdConnector {
  platform: Platform;
  label: string;
  /** What the "page" means on this platform, or null if not needed. */
  pageLabel: string | null;
  getAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenResult>;
  /** For platforms with short-lived access tokens. */
  refresh?(refreshToken: string): Promise<TokenResult>;
  listAdAccounts(accessToken: string): Promise<AdAccount[]>;
  listPages(accessToken: string, adAccountId?: string): Promise<Page[]>;
  launchCampaign(ctx: AccountContext, spec: CampaignSpec): Promise<LaunchResult>;
  setStatus(ctx: AccountContext, platformIds: Record<string, string>, status: "ACTIVE" | "PAUSED"): Promise<void>;
  getInsights(ctx: AccountContext, platformIds: Record<string, string>): Promise<Insights>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** Options shared by every connector factory (injectable for tests). */
export interface ConnectorDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a platform to finish processing an uploaded video. */
  mediaTimeoutMs?: number;
  mediaPollMs?: number;
}

export function deps(d: ConnectorDeps) {
  return {
    fetch: d.fetch ?? fetch,
    sleep: d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    mediaTimeoutMs: d.mediaTimeoutMs ?? 180_000,
    mediaPollMs: d.mediaPollMs ?? 3_000,
  };
}

/** Poll until `check` returns a value, or fail after the timeout. */
export async function pollUntil<T>(
  d: ReturnType<typeof deps>,
  check: () => Promise<T | undefined>,
  what: string,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await check();
    if (v !== undefined) return v;
    if (Date.now() - started > d.mediaTimeoutMs) {
      throw new ConnectorError(`Timed out waiting for ${what}. Please try again in a minute.`);
    }
    await d.sleep(d.mediaPollMs);
  }
}

/** Download a video/image into memory (needed by platforms that don't accept URLs). */
export async function downloadFile(d: ReturnType<typeof deps>, url: string, maxBytes = 500 * 1024 * 1024) {
  const res = await d.fetch(url);
  if (!res.ok) throw new ConnectorError(`Could not download media from ${url} (HTTP ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new ConnectorError("Video file is too large for this platform");
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "video/mp4" };
}

/** Age range → the platform-neutral 18-24/25-34/... buckets most platforms use. */
export function ageBuckets(min: number, max: number) {
  const buckets: [number, number][] = [
    [18, 24],
    [25, 34],
    [35, 44],
    [45, 54],
    [55, 64],
    [65, 120],
  ];
  return buckets.filter(([lo, hi]) => hi >= min && lo <= max);
}

export function dateParts(d: Date) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
