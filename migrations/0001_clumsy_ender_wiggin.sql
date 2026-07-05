CREATE TABLE "schooling" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" varchar NOT NULL,
	"high_school" text,
	"colleges" jsonb DEFAULT '[]'::jsonb,
	"additional_schooling" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "import_date" timestamp;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "import_uuid" varchar;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "import_date" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "import_uuid" varchar;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "center_account_id" varchar;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "crowd_members" text[] DEFAULT ARRAY[]::text[];--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "crowd_last_calculated_at" timestamp;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD COLUMN "import_date" timestamp;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD COLUMN "import_uuid" varchar;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "import_date" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "import_uuid" varchar;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "maiden_name" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "jobs" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "group_id" varchar;--> statement-breakpoint
ALTER TABLE "schooling" ADD CONSTRAINT "schooling_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_center_account_id_social_accounts_id_fk" FOREIGN KEY ("center_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;