CREATE TABLE "image_questions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" varchar NOT NULL,
	"face_uuid" varchar NOT NULL,
	"sub_image_url" text NOT NULL,
	"coordinates" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_as" text,
	"resolved_person_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
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
ALTER TABLE "photos" ADD COLUMN "facial_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "image_questions" ADD CONSTRAINT "image_questions_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_questions" ADD CONSTRAINT "image_questions_resolved_person_id_people_id_fk" FOREIGN KEY ("resolved_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_center_account_id_social_accounts_id_fk" FOREIGN KEY ("center_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;