import { z } from "zod";

/**
 * One campaign format for every platform. Each connector translates this
 * spec into its platform's own structure (Meta: campaign → ad set → ad,
 * Google: campaign → ad group → ad, ...).
 */

export const PLATFORMS = ["meta", "google"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const OBJECTIVES = ["traffic", "awareness", "video_views"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const CALL_TO_ACTIONS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WATCH_MORE", "CONTACT_US", "BOOK_NOW"] as const;

export const CampaignSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    objective: z.enum(OBJECTIVES),
    /** Daily budget in major currency units (e.g. 500 means ₹500/day). */
    dailyBudget: z.number().positive(),
    startTime: z.iso.datetime({ offset: true }).optional(),
    endTime: z.iso.datetime({ offset: true }).optional(),
    audience: z.object({
      /** ISO 3166-1 alpha-2 country codes, e.g. ["IN"] */
      countries: z.array(z.string().length(2).toUpperCase()).min(1),
      ageMin: z.number().int().min(18).max(65).default(18),
      ageMax: z.number().int().min(18).max(65).default(65),
      gender: z.enum(["all", "male", "female"]).default("all"),
    }),
    creative: z.object({
      videoUrl: z.url(),
      /** Optional cover image. If missing, the platform's generated thumbnail is used. */
      thumbnailUrl: z.url().optional(),
      primaryText: z.string().trim().min(1).max(2000),
      headline: z.string().trim().min(1).max(255),
      linkUrl: z.url(),
      callToAction: z.enum(CALL_TO_ACTIONS).default("LEARN_MORE"),
    }),
    /** Safety default: everything is created PAUSED unless this is true. */
    launchActive: z.boolean().default(false),
  })
  .refine((s) => s.audience.ageMin <= s.audience.ageMax, {
    message: "audience.ageMin must be ≤ audience.ageMax",
    path: ["audience", "ageMin"],
  })
  .refine((s) => !s.startTime || !s.endTime || new Date(s.startTime) < new Date(s.endTime), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });

export type CampaignSpec = z.infer<typeof CampaignSpecSchema>;

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

export interface AdConnector {
  platform: Platform;
  label: string;
  getAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenResult>;
  listAdAccounts(accessToken: string): Promise<AdAccount[]>;
  listPages(accessToken: string): Promise<Page[]>;
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
