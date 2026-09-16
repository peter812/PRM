ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "political_left_right" real;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "political_lib_auth" real;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "political_updated_at" timestamp;
