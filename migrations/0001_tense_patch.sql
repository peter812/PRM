CREATE TABLE "social_connections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" varchar NOT NULL,
	"following_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_follower_id_social_accounts_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_following_id_social_accounts_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_follow_idx" ON "social_connections" USING btree ("follower_id","following_id");--> statement-breakpoint
CREATE INDEX "following_idx" ON "social_connections" USING btree ("following_id");--> statement-breakpoint
ALTER TABLE "social_network_state" DROP COLUMN "followers";--> statement-breakpoint
ALTER TABLE "social_network_state" DROP COLUMN "following";