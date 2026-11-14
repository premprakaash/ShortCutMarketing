CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"daily_budget" integer NOT NULL,
	"currency" text,
	"status" text NOT NULL,
	"platform_ids" jsonb NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"display_name" text,
	"access_token_enc" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"ad_account_id" text,
	"ad_account_name" text,
	"currency" text,
	"page_id" text,
	"page_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;