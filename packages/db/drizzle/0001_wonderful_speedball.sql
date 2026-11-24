ALTER TABLE "icps" ADD COLUMN "negative_signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "icps" ADD COLUMN "segments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "icps" ADD COLUMN "rationale" text;