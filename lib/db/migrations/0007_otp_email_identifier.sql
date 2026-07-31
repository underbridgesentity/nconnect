-- Email replaces phone as the customer sign-in credential (client change,
-- July 2026). Phone stays a required contact detail because RICA needs a
-- reachable number for any SIM-based service; it simply stops being the key.
--
-- What this does to live data:
--   * otp_codes.phone becomes otp_codes.identifier, holding either an email
--     address or an E.164 number, and gains a channel column saying which.
--     Every existing row was a phone code, so every row is backfilled to
--     'phone' and nothing is lost. Codes in flight at deploy time keep working:
--     the phone flows still ask on the phone channel.
--   * The channel is part of the lookup from here on, so a code sent to an
--     address can never satisfy a challenge on a number or the reverse. Two
--     channels, two independent proofs.
--   * users.email becomes case-insensitively unique. Sign-in lowercases before
--     it looks anyone up, so a stored mixed-case address would be an account
--     nobody could reach while still occupying the address. Today users.email
--     holds staff logins only, already lowercase, so this rewrites no rows; it
--     is in place before customer addresses start arriving. Postgres treats
--     NULLs as distinct, so customers who have no email yet are unaffected.
--     If this index fails to build, two accounts differ only by case and must
--     be merged by hand before the deploy proceeds. That is the correct
--     outcome: silently keeping both would mean one customer locked out.
CREATE TYPE "otp_channel" AS ENUM ('email', 'phone');--> statement-breakpoint

ALTER TABLE "otp_codes" RENAME COLUMN "phone" TO "identifier";--> statement-breakpoint

ALTER TABLE "otp_codes" ADD COLUMN "channel" "otp_channel";--> statement-breakpoint
UPDATE "otp_codes" SET "channel" = 'phone' WHERE "channel" IS NULL;--> statement-breakpoint
ALTER TABLE "otp_codes" ALTER COLUMN "channel" SET NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "otp_codes_phone_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_codes_identifier_idx"
  ON "otp_codes" USING btree ("channel", "identifier");--> statement-breakpoint

DROP INDEX IF EXISTS "users_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_unique"
  ON "users" USING btree (lower("email"));
