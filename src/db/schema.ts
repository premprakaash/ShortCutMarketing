import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** An ad-platform account a user has connected (one row per platform login). */
export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  platform: text("platform").notNull(), // "meta" | "google" | ...
  displayName: text("display_name"),
  accessTokenEnc: text("access_token_enc").notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  // Selected ad account / page for this connection
  adAccountId: text("ad_account_id"),
  adAccountName: text("ad_account_name"),
  currency: text("currency"),
  pageId: text("page_id"),
  pageName: text("page_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A campaign launched through ShortCut Marketing. */
export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
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

export type Connection = typeof connections.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
