CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"duration" integer NOT NULL,
	"status" text NOT NULL,
	"status_url" text,
	"response_url" text,
	"video_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "refresh_token_enc" text;