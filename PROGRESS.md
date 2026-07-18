# Needd Connect — build progress

Working notes per the spec (§0.2–0.3). Updated after each milestone with
decisions taken where the spec was silent, and open items for the client.

## Launch checklist seeds (carry into LAUNCH-CHECKLIST.md at M8)

1. **Confirm hardware retail pricing with client** — the previous live site
   sold some routers higher than the May 2026 catalogue (Cudy GP1200 R999 vs
   R417, GP3000 R1 499 vs R550, LT500 R1 299 vs R640, LT500 Outdoor R2 199 vs
   R1 056). The catalogue values are seeded; do not publish price changes
   without client sign-off.
2. **Fibre once-off fees** — seeded R0; client to confirm installation and
   activation fees per FNO before publish.
3. Client fills wholesale cost prices in Catalogue UI (all `cost_cents` seeded null).
4. EFT banking details are placeholders in `settings.banking`.

## M0 — Foundation ✅ (2026-07-18)

Scaffold: Next.js 16 (App Router, Turbopack), TS strict, Tailwind 4,
shadcn/ui restyled to the §11 tokens. Geist Sans/Mono self-hosted via the
`geist` package.

Done:
- Brand assets processed from the client's logo pack (`docs/brand-source/`)
  into `public/brand/` (trimmed, resized, favicon + PWA icons). **Accent
  colour sampled from the logo: `#136FB0`** (spec's #1B5FAA guess adjusted per
  §11 instruction); ink navy `#121829`. Status palette per §11.
- `lib/money`: integer-cents utilities (add/subtract/multiply/percentOf/
  allocate/prorata with exact complement/format/parse) — 14 unit tests green.
- Full Drizzle schema for every §4 table + enums + FK/queue indexes, plus
  `number_sequences`, `otp_codes`, `invite_tokens`, `signup_drafts`.
  Migrations committed; local dev DB `nconnect_dev` (Homebrew Postgres 17).
- Auth.js v5: staff email+argon2 login, customer phone-OTP login (6-digit,
  hashed at rest, 5-min expiry, per-phone and per-IP rate limits; WhatsApp →
  SMS fallback; console SMS driver in dev). JWT carries role + customerId.
- `lib/auth/permissions.ts` capability map (§12) + `authorize()` gate with
  own/self resource scoping; fails closed.
- `lib/crypto.ts`: AES-256-GCM for ID numbers + maskIdNumber.
- Route gating via Next 16 `proxy.ts` (middleware convention renamed) for
  /admin, /sales, /portal; role-aware post-login router at /after-login.
- Inngest v4 wired (`/api/inngest`), outbox pattern: `domain_events` written
  in-transaction, best-effort forward + 5-min drain cron.
- Notification channel adapters: WhatsApp Cloud API (env-gated), Resend email
  (console fallback without key), pluggable SMS (console/smsportal/clickatell).
- Shells: admin sidebar (six §9.4 areas), sales nav, portal bottom tabs —
  honest empty states, no fake data. Shared StatusPill / MoneyText /
  EmptyState / SignOutButton.
- Idempotent full seed (§14): 8 providers, 26 plans, 20 hardware SKUs,
  1 draft bundle, settings defaults, admin (invited in prod; dev gets
  printed credentials), dev sales rep + demo customer.
- `vercel.json` pinned to `cpt1`.

Verified live: staff login → admin Today shell; customer OTP login (console
code) → portal. `tsc --noEmit`, eslint, vitest all green.

Decisions where the spec was silent:
- MTN/Vodacom dual-network LTE plans are seeded once under MTN with
  `metadata.network = "MTN / Vodacom"` (catalogue sells them as one offer).
- OTP rate limits: 5/phone/hour, 15/IP/hour, 5 verify attempts per code.
- Sales role may also enter /sales via admin accounts (admin ⊇ sales nav
  access); customer surface is customer-only.
- Dev seed prints random credentials rather than fixed passwords.

## M1 — Catalogue + public site ✅ (2026-07-18)

Done:
- Catalogue domain (`lib/domain/catalogue.ts`): public + admin queries,
  plan/hardware/bundle upsert and publish mutations — all zod → authorize →
  transaction → audit; publish triggers `revalidateTag("catalogue")` +
  per-path ISR revalidation.
- Admin Catalogue area: Plans grouped by category with sell/cost/computed
  margin and missing-cost badges; Hardware with image upload (sharp: min
  800px enforced, converted to webp, max 1600px) plus stock and threshold;
  Bundle builder with plans + hardware + custom lines and a live margin
  readout; draft/publish/archive on all three; "Generate PDF catalogue"
  renders the published records to a branded A4 PDF via @react-pdf/renderer
  (also runnable via `pnpm tsx scripts/render-catalogue.tsx`).
- Storage adapter (`lib/storage.ts`): Supabase buckets in production; local
  `.uploads/` + HMAC-signed expiring URLs in dev (`/api/files/...`) so the
  signed-URL contract is identical. Recorded per §16.10.
- Public site (§9.1), all server-rendered: Home (hero, category cards,
  featured plans/bundles, how-it-works, trust strip, FAQ + FAQPage JSON-LD),
  /internet /fibre (grouped by FNO, `?fno=` filter) /voip /sim-data with
  crawlable server-driven sort params, /plans/[slug] (Product JSON-LD,
  canonical, FUP in plain language, what-happens-next, hardware
  suggestions), /hardware + /hardware/[sku], /bundles + detail, /coverage
  (LTE instant answer with honest disclaimer; fibre feasibility promise
  creating a `web_coverage` lead — provisioning task joins in M3), About,
  Contact, Help/FAQ, Blog (2 real MDX posts), POPIA/Privacy/Terms/RICA
  legal pages with real copy, /q/[token] route stub (full render in M7).
- SEO: per-page metadata + canonicals, sitemap.xml, robots.txt,
  Organization/Product/FAQPage JSON-LD, ISR (revalidate 3600) with
  on-demand revalidation from publish actions. 26 plan pages prerendered
  at build.
- /signup placeholder: preserves plan/bundle preselection, honestly routes
  to WhatsApp until the M2 wizard replaces it.

Verified: `curl` of `/` and `/plans/telkom-lte-plus` returns full readable
HTML without JS including Product JSON-LD; sitemap + robots valid;
catalogue PDF rendered and visually checked (branded, all categories,
company footer); admin catalogue UI verified in browser (margin badges,
editor drawer, publish menu). Typecheck, lint, tests, production build all
green.

Notes / deviations:
- Category pages using search params render dynamically (still full SSR
  HTML); detail pages are SSG + revalidate.
- Lighthouse run deferred to M8 hardening (pages are static/ISR,
  self-hosted fonts, no client JS beyond the shells — structurally in
  line with the >=90 target).

## M2 — Signup, orders, payments-in ✅ (2026-07-18)

Done:
- PayFast integration (`lib/payfast.ts`): redirect checkout builder, ITN
  signature verification (byte-identical to PHP `urlencode` — JS
  `encodeURIComponent` differs on `!'()*` and broke signatures), source-IP
  check against PayFast's published hosts, server-to-server validation in
  live mode, ad-hoc token charge for M4. Signature unit-tested against an
  independent PHP-urlencode reference vector.
- Orders domain: server-side cart pricing (client sends identifiers only),
  mandatory snapshots, gap-free NC-/INV- sequences via a locked upsert,
  `markOrderPaid` (idempotent by order status + unique gateway ref) creating
  the paid order invoice + payment + stock decrement + audit + `order.paid`
  and `payment.received` outbox events.
- Invoice PDF (`lib/pdf/invoice.tsx`) attached to the receipt email; EFT
  banking box shown on unpaid invoices.
- Notification dispatcher (`lib/notify`) + template registry — full §8
  matrix copy in place; WhatsApp legs fall back to email while disabled.
- 3-step wizard: server-held draft (opaque cookie → `signup_drafts`),
  preselection deep-links (?plan=/?bundle=), hardware attach with running
  total pinned bottom, address step with ManualConnector coverage semantics
  (fibre → feasibility lead + warm exit page), step 3 with inline OTP that
  creates user+customer atomically, explicit unticked POPIA consent +
  separate marketing opt-ins, conditional RICA capture (ID number +
  camera/file uploads → compliance bucket, normalised to webp), order
  review, PayFast auto-submitting redirect, honest "confirming payment"
  return page, one-tap portal sign-in via a single-use internal OTP.
- Abandoned-signup capture: hourly Inngest cron turns stale drafts (contact
  + selection, no order) into `web_abandoned` leads with what they chose.
- `scripts/simulate-itn.ts`: signs and posts a sandbox-grade ITN to the
  local webhook (PayFast can't reach localhost).

Verified end-to-end in a 375px browser: plan page → wizard → OTP (console)
→ POPIA consent → review → PayFast sandbox redirect reached → simulated
ITN → order paid + invoice INV-2026-00001 + payment + card token stored +
admin bell + receipt email (console) → success page → "Open your portal"
signs the customer in. ITN replay left exactly one payment. Compliance
upload + signed URL round-trip verified (tampered signature → 403).

**Blocked on real-world credential (spec §16.10):** PayFast's shared
sandbox merchant (10000100) no longer accepts third-party signatures —
merchants must register their own sandbox account. Everything up to the
PayFast hosted page is exercised for real; the hosted-page hop itself needs
the client's sandbox credentials (launch checklist). `PAYFAST_PASSPHRASE`
currently empty in dev.

## M3 — Service lifecycle + ops ✅ (2026-07-18)

Done:
- Connector abstraction (`lib/connectors`): §7 interface, ManualConnector
  creating typed provisioning tasks with category-specific checklists
  (SIM: RICA check/SIM allocation/MSISDN; fibre: circuit/feasibility; VoIP:
  extensions/porting); `checkCoverage` honest semantics; `getUsage` null.
- State machine (`lib/domain/services.ts`) — the only status-write path.
  All §5 transitions implemented: paid order → pending services (incl.
  bundle plans) → auto-provisioning → task; activation sets activation
  date + clamped anchor day + next invoice date and fires
  `service_activated`; suspend/reactivate/cancel-request/withdraw/finalize/
  admin-override each audited + evented, connector tasks per transition;
  goodwill audit note when activation lags payment >14 days; RICA gate
  blocks SIM activation without a verified record.
- Task completion records provider external ref, MSISDN, circuit, SIM
  (creates/updates `sims`, links service, deactivates on cancel).
- Manual EFT recording (`lib/domain/billing.ts`): partial-payment aware,
  clears pending collection attempts, uniform payment.received flow,
  auto-reactivates suspended services when everything past due settles.
- Admin Today queue: six §9.4.1 sections live (provisioning tasks with
  inline checklists + completion form, past-due invoices, waiting
  conversations, fibre feasibility with WhatsApp links + close form, RICA
  verification with audited signed-URL doc access + verify/reject, true
  low stock) + the slim strip (active services, MRR, open conversations).
- Customers area: searchable list (ILIKE), CSV export, 360 page with
  header (balance/status/rep), tabs Overview/Services/Billing (record EFT,
  mark pending orders paid → services created)/Conversations/Documents &
  RICA/Audit/Notes; service actions (suspend, reactivate, override cancel
  with mandatory reason).
- Feasibility flow: fibre coverage/signup leads now create a
  feasibility_check task (leadId; no service yet) landing in Today.
- Fix: dev DB pool cached on globalThis (Turbopack hot-reload was
  exhausting Postgres connections).

Verified in browser: SIM order (Telkom LTE Starter + router, R1 611) paid
via simulated ITN → service pending→provisioning + activation task + RICA
linked; Today queue showed task + 2 RICA records; verified RICA; ticked
all 5 checklist items (persisted); completed with external ref + ICCID +
MSISDN → service active, anchor day 18, next invoice 2026-08-18, SIM
active, provider account recorded; full audit chain
(service.pending → service.provisioning → rica.verify →
provisioning.activate.complete → service.active). Customer 360 renders
services/billing/RICA/audit. Typecheck/lint/tests green.

## M4 — Billing engine ✅ (2026-07-18)

Done:
- `lib/domain/billing-engine.ts`, all date inputs explicit for time-travel:
  - Anniversary invoice generation (§6.1): period anchor→anchor, due +7d
    (settings), idempotent per service+period, pointer always advances,
    scheduled-downgrade rollover at the anchor (audited), invoice_issued
    notification with pay link + PDF.
  - Dunning (§6.3): token charges on days 0/2/5 (idempotent per attempt
    slot), past_due at +7 with the 3-day warning, suspension at +10 through
    the state machine, +40 unpaid+suspended → admin decision bell (nothing
    automatic). Payment at any point clears pending attempts; settling
    everything past due auto-reactivates via the state machine.
  - Token charges via injectable `Charger` (PayFast ad-hoc token API in
    production; mocks in tests); failures notify payment_failed with link.
  - Plan changes (§5): upgrade immediate with integer-exact
    prorata_credit/prorata_charge adjustment invoice (remainder on the
    charge line), plan swaps at once, change_plan task, token charged or
    pay link sent; downgrade scheduled at next anchor via
    pending_plan_id/plan_change_effective_date, swapped in the billing run.
  - Age analysis buckets (current/30/60/90+) per customer.
- Pay links: HMAC-tokenised public `/pay/[invoiceId]` page rendering lines
  + PayFast form (`m_payment_id = inv:<id>`); ITN webhook routes the inv:
  prefix through `markInvoicePaidFromGateway` (idempotent, amount-checked).
- Inngest `billing-run` daily at 02:00 Africa/Johannesburg: invoices →
  dunning → cancellation sweep, in that order.
- Admin Billing area: invoice list with status filters, age analysis,
  payments log, read-only dunning timeline from settings.
- Tests (29 total green): §5 pro-rata unit tests across 28/29/30/31-day
  periods proving credit+consumed ≡ old price and charge ≡ exact
  complement at every day offset; DB-backed time-travel integration suite
  driving issue → 3 failed charges → past_due → suspended → paid (manual
  EFT) → auto-reactivated, plus token-charge success, upgrade adjustment
  exactness and downgrade rollover.

Notes:
- Integration tests run against the dev DATABASE_URL with their own
  fixtures; time-travel runs can also invoice real dev services whose
  anchor falls inside the travelled window (harmless in dev; CI should use
  a scratch database).
- Reactivation fee (settings `reactivation_fee_cents`, default 0) is not
  yet charged as a line; revisit in M8 hardening if the client wants it.
- Bulk reminders button on the Billing area deferred to M8 with the
  reconciliation worksheet.

## M5 — Inbox + notifications (next)

- [ ] Unified conversations (portal + WhatsApp), realtime, internal notes,
      assignment, WhatsApp inbound webhook, full matrix wiring.
