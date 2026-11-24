ALTER TABLE "companies" ADD COLUMN "fit_reason" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "icp_id" uuid;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE set null ON UPDATE no action;