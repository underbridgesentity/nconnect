-- VAT on invoices and invoice lines (SPEC §5, LAUNCH-CHECKLIST "VAT treatment").
--
-- Today the company VAT number prints on every invoice footer while nothing in
-- the system computes VAT. A South African tax invoice must show the VAT amount
-- and the rate, so this adds the columns that carry them and the application
-- stops printing the VAT number on any document that does not have them.
--
-- What this does to live data:
--   * Adds nullable vat_rate_basis_points and vat_cents to invoices, and
--     vat_cents and vat_rate_basis_points to invoice_lines. Every existing row
--     keeps NULL in all four, which is the truthful value: those invoices were
--     issued while the company was not VAT registered and genuinely carried no
--     VAT. They are deliberately NOT backfilled to 0, because 0 would assert
--     "a VAT vendor charged zero VAT", a different and false statement.
--   * Rewrites no amounts. subtotal_cents, total_cents and
--     invoice_lines.amount_cents are untouched on every existing row, so no
--     customer's balance, no payment allocation and no age analysis moves by a
--     cent when this is applied.
--   * Rates are stored in basis points (integer): 15% is 1500. Money never
--     meets a float, and neither does the rate that multiplies it.
--   * The rate is snapshotted on the invoice at issue time, like every other
--     price snapshot in this schema, so a future rate change cannot rewrite
--     what an already-issued document said.
--   * From here on invoice_lines.amount_cents is defined as EXCLUDING VAT, so
--     sum(amount_cents) = invoices.subtotal_cents and subtotal + VAT = total.
--     With no VAT charged, net equals gross and that definition is exactly the
--     current behaviour, so this is a clarification for existing rows, not a
--     change to them.
--
-- Behaviour on deploy: the seeded `vat` setting is { registered: false,
-- rateBasisPoints: 0, pricesIncludeVat: true }, so new invoices also write NULL
-- to these columns and no VAT is charged or claimed anywhere until the business
-- owner confirms the company's VAT position and changes the setting.
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "vat_rate_basis_points" integer;--> statement-breakpoint
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "vat_cents" integer;--> statement-breakpoint

ALTER TABLE "invoice_lines"
  ADD COLUMN IF NOT EXISTS "vat_cents" integer;--> statement-breakpoint
ALTER TABLE "invoice_lines"
  ADD COLUMN IF NOT EXISTS "vat_rate_basis_points" integer;--> statement-breakpoint

-- A rate without an amount, or an amount without a rate, is a half-written tax
-- invoice and the surfaces would disagree about whether to print the VAT
-- number. The pair is enforced here so no future writer can create one.
ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_vat_pair_check";--> statement-breakpoint
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_vat_pair_check"
  CHECK (("vat_rate_basis_points" IS NULL) = ("vat_cents" IS NULL));--> statement-breakpoint

ALTER TABLE "invoice_lines"
  DROP CONSTRAINT IF EXISTS "invoice_lines_vat_pair_check";--> statement-breakpoint
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_vat_pair_check"
  CHECK (("vat_rate_basis_points" IS NULL) = ("vat_cents" IS NULL));--> statement-breakpoint

-- A rate outside 0..100% is a typo in a settings field, and it would land on
-- customer documents. Basis points, so 10000 is 100%.
ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_vat_rate_range_check";--> statement-breakpoint
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_vat_rate_range_check"
  CHECK ("vat_rate_basis_points" IS NULL
         OR ("vat_rate_basis_points" >= 0 AND "vat_rate_basis_points" <= 10000));--> statement-breakpoint

ALTER TABLE "invoice_lines"
  DROP CONSTRAINT IF EXISTS "invoice_lines_vat_rate_range_check";--> statement-breakpoint
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_vat_rate_range_check"
  CHECK ("vat_rate_basis_points" IS NULL
         OR ("vat_rate_basis_points" >= 0 AND "vat_rate_basis_points" <= 10000));--> statement-breakpoint

-- The seeded VAT position: not registered, so nothing is charged and no VAT
-- number prints. Seeded here as well as in db/seed.ts because production is
-- migrated, not seeded, and the reader must find a row rather than fall back.
-- ON CONFLICT DO NOTHING so a deployment that has already had the client's real
-- VAT position entered is never reset to "not registered" by a re-run.
INSERT INTO "settings" ("key", "value")
VALUES ('vat', '{"registered": false, "rateBasisPoints": 0, "pricesIncludeVat": true}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
