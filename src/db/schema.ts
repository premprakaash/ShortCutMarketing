import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** An ad-platform account a user has connected (one row per platform login). */
export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull(), // "meta" | "google" | "tiktok" | ...
  displayName: text("display_name"),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  // Selected ad account / page (or identity, board, profile) for this connection
  adAccountId: text("ad_account_id"),
  adAccountName: text("ad_account_name"),
  currency: text("currency"),
  pageId: text("page_id"),
  pageName: text("page_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A campaign launched through ShortCut Marketing (one row per platform). */
export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  /** Campaigns launched together from one form share a groupId. */
  groupId: text("group_id"),
  connectionId: text("connection_id")
    .notNull()
    .references(() => connections.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  dailyBudget: integer("daily_budget").notNull(), // major currency units, e.g. 500 = ₹500
  currency: text("currency"),
  status: text("status").notNull(), // "PAUSED" | "ACTIVE"
  // IDs of the objects created on the ad platform
  platformIds: jsonb("platform_ids").$type<Record<string, string>>().notNull(),
  spec: jsonb("spec").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** AI video generation jobs (fal.ai queue). */
export const videoJobs = pgTable("video_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(), // "fal"
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  duration: integer("duration").notNull(), // seconds
  status: text("status").notNull(), // "queued" | "running" | "done" | "failed"
  statusUrl: text("status_url"),
  responseUrl: text("response_url"),
  videoUrl: text("video_url"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Connection = typeof connections.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type VideoJob = typeof videoJobs.$inferSelect;
