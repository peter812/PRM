ALTER TABLE "daily_notes" ADD COLUMN IF NOT EXISTS "user_id" integer;
--> statement-breakpoint
UPDATE "daily_notes"
SET "user_id" = (
  COALESCE(
    (SELECT "id" FROM "users" WHERE "role" = 'super_admin' ORDER BY "id" ASC LIMIT 1),
    (SELECT "user_id" FROM "people" WHERE "user_id" IS NOT NULL ORDER BY "user_id" ASC LIMIT 1),
    (SELECT "id" FROM "users" ORDER BY "id" ASC LIMIT 1)
  )
)
WHERE "user_id" IS NULL OR "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "users") AND NOT EXISTS (SELECT 1 FROM "daily_notes" WHERE "user_id" IS NULL) THEN
    ALTER TABLE "daily_notes" ALTER COLUMN "user_id" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_notes_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_notes_user_id_idx" ON "daily_notes" USING btree ("user_id");
