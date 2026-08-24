CREATE TABLE IF NOT EXISTS "pending_social_account_imports" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp_added" timestamp with time zone NOT NULL,
	"timestamp_imported" timestamp with time zone,
	"already_added" boolean DEFAULT false NOT NULL,
	"account_username" varchar(255) NOT NULL,
	"account_display_name" varchar(255),
	"account_bio" text,
	"account_website" varchar(500),
	"account_email" varchar(255),
	"account_phone" varchar(100),
	"account_location_area" varchar(255),
	"account_followers" text,
	"account_following" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_imports_username" ON "pending_social_account_imports" ("account_username");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_imports_already_added" ON "pending_social_account_imports" ("already_added");
