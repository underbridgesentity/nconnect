# Needd Connect, build progress

Working notes per the spec (§0.2–0.3). Updated after each milestone with
decisions taken where the spec was silent, and open items for the client.

## Launch checklist seeds (carry into LAUNCH-CHECKLIST.md at M8)

1. **Confirm hardware retail pricing with client**, the previous live site
   sold some routers higher than the May 2026 catalogue (Cudy GP1200 R999 vs
   R417, GP3000 R1 499 vs R550, LT500 R1 299 vs R640, LT500 Outdoor R2 199 vs
   R1 056). The catalogue values are seeded; do not publish price changes
   without client sign-off.
2. **Fibre once-off fees**, seeded R0; client to confirm installation and
   activation fees per FNO before publish.
3. Client fills wholesale cost prices in Catalogue UI (all `cost_cents` seeded null).
4. EFT banking details are placeholders in `settings.banking`.

## M0, Foundation ✅ (2026-07-18)

Scaffold: Next.js 16 (App Router, Turbopack), TS strict, Tailwind 4,
shadcn/ui restyled to the §11 tokens. Geist Sans/Mono self-hosted via the
`geist` package.

Done:
- Brand assets processed from the client's logo pack (`docs/brand-source/`)
  into `public/brand/` (trimmed, resized, favicon + PWA icons). **Accent
  colour sampled from the logo: `#136FB0`** (spec's #1B5FAA guess adjusted per
  §11 instruction); ink navy `#121829`. Status palette per §11.
- `lib/money`: integer-cents utilities (add/subtract/multiply/percentOf/
  allocate/prorata with exact complement/format/parse), 14 unit tests green.
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
- Shells: admin sidebar (six §9.4 areas), sales nav, portal bottom tabs , 
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

## M1, Catalogue + public site ✅ (2026-07-18)

Done:
- Catalogue domain (`lib/domain/catalogue.ts`): public + admin queries,
  plan/hardware/bundle upsert and publish mutations, all zod → authorize →
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
  creating a `web_coverage` lead, provisioning task joins in M3), About,
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
  self-hosted fonts, no client JS beyond the shells, structurally in
  line with the >=90 target).

## M2, Signup, orders, payments-in ✅ (2026-07-18)

Done:
- PayFast integration (`lib/payfast.ts`): redirect checkout builder, ITN
  signature verification (byte-identical to PHP `urlencode`, JS
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
- Notification dispatcher (`lib/notify`) + template registry, full §8
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
sandbox merchant (10000100) no longer accepts third-party signatures , 
merchants must register their own sandbox account. Everything up to the
PayFast hosted page is exercised for real; the hosted-page hop itself needs
the client's sandbox credentials (launch checklist). `PAYFAST_PASSPHRASE`
currently empty in dev.

## M3, Service lifecycle + ops ✅ (2026-07-18)

Done:
- Connector abstraction (`lib/connectors`): §7 interface, ManualConnector
  creating typed provisioning tasks with category-specific checklists
  (SIM: RICA check/SIM allocation/MSISDN; fibre: circuit/feasibility; VoIP:
  extensions/porting); `checkCoverage` honest semantics; `getUsage` null.
- State machine (`lib/domain/services.ts`), the only status-write path.
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

## M4, Billing engine ✅ (2026-07-18)

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

## M5, Inbox + notifications ✅ (2026-07-18)

Done:
- Inbox domain (`lib/domain/inbox.ts`): start/post/assign/resolve with
  authorize() scoping; staff replies delivered per §8 (WhatsApp text when
  the channel is whatsapp and enabled, else portal bell + email with a
  deep link); internal notes never leave the building; inbound messages
  reopen resolved threads and bell all admins + the assigned rep.
- WhatsApp inbound webhook (`/api/webhooks/whatsapp`): Meta verification
  handshake (403 on bad token), message ingestion matched to customers by
  phone, idempotent by WhatsApp message id, always-200 so Meta stops
  retrying, non-text messages recorded as typed placeholders.
- Realtime (`lib/realtime.ts`): server-side Supabase broadcast on
  `admin:inbox`, `conversation:{id}`, `user:{id}` after writes. Without
  Supabase creds (dev) broadcasts no-op and an `AutoRefresh` 5s polling
  fallback keeps the UI live, recorded per §16.10; scoped client tokens
  activate when the Supabase project exists.
- Admin Inbox (§9.4.5): list with channel chips + status/assignee filters,
  thread view, reply box with visually-distinct internal notes (amber,
  "never sent"), assignment select, resolve/reopen, replaces the old
  Tickets + Communications split entirely.
- Portal Help: conversation list, new-conversation form, thread with reply
  + photo attachments (webp-normalised into the private documents bucket,
  rendered via signed URLs), ownership-scoped 404s, internal notes
  filtered out of the customer view.
- Bell UI on all three surfaces: unread badge, recent list, mark-all-read.

Verified in browser: customer (OTP login) started a portal conversation →
admin bell "New message from Lerato Molefe" + inbox thread; admin added an
internal note and a reply → customer bell + email (console) recorded;
simulated Meta webhook created an identified WhatsApp conversation and a
replayed message id inserted exactly once. Typecheck/lint/29 tests green.
Also fixed: Base UI hydration mismatch on the bell trigger and anchor
semantics on the PDF button.

## M6, Portal complete + PWA ✅ (2026-07-18)

Done:
- Portal Home: real service cards (status pill, next invoice, monthly),
  provisioning/suspended/pending-cancellation states in plain language,
  outstanding banner with a prominent Pay now (oldest open invoice link).
- Service detail: plan + pricing + FUP plain language, install address,
  linked hardware from the origin order, no usage module (ManualConnector
  returns null, nothing fake in its place).
- Plan change: same-category list marked upgrade/downgrade; upgrade shows
  the exact engine pro-rata summary (credit/charge/due-now) before
  confirm and applies immediately; downgrade states its effective date
  plainly and schedules at the anchor.
- Cancellation with retention: one honest screen (cheaper plans + talk to
  us), confirm with effective date, withdraw button while pending.
- Billing: outstanding banner, invoice list with per-invoice PDF
  (customer-scoped route) + pay links, payment-method card (token from
  checkout; replacement happens on the next online payment, PayFast has
  no charge-free tokenisation endpoint, noted for launch), payment history.
- Account: profile edit, addresses, marketing consent toggles (append-only
  consent history with IP/UA), consent timeline, POPIA "Request my data"
  (admin bell + audit + written email confirmation), sign out.
- PWA: manifest (brand icons, standalone, /portal start), minimal service
  worker (network-first navigation, offline shell at /offline, cache-first
  brand assets only, no dynamic caching), registered from the portal.

Verified at 390px in browser: OTP sign-in → home with outstanding banner →
service detail → change plan (pro-rata summary matched the engine: credit
-R331 / charge R654 / due R323; plan swapped, INV-2026-00042 created) →
billing (card-on-file shown from the checkout token, PDFs + pay links) →
account. manifest.webmanifest, /sw.js and /offline all 200.

## M7, Sales workspace ✅ (2026-07-18)

Done:
- Quotes domain: snapshot pricing at creation, §10.4 discount floor
  (cost set → discounted ≥ cost × (1 + floor%); cost null → ≤ 15% of
  sell; admins bypass via quote.discount_below_floor; the error message
  explains the block honestly), Q- sequence, share tokens, validity from
  settings, send via WhatsApp template + email (lead → quoted +
  activity), viewed flip with sales bell, quote list per §12 scoping.
- Leads: quick-add (name + phone, phone-sized), unclaimed web leads
  claimable, detail with activity timeline (note/call/whatsapp/status),
  status transitions with lost reason, convert-to-quote entry.
- Quote builder: plans/hardware/bundles/custom with quantities and
  per-line discounts, live line + total margin visible to the rep
  (computed, cost never shown or editable), save draft / send.
- Acceptance flow (/q/[token]/accept): lead-prefilled contact → OTP →
  POPIA → address (+ RICA when the quote includes a SIM) →
  `createOrderFromQuote` locks pricing to quote snapshots (discounts
  applied, cost snapshots carried), attributes the customer to the rep,
  flips quote accepted + lead won, then PayFast redirect. ITN payment
  then provisions services as usual.
- Sales home: pipeline counts by status, quotes awaiting response with
  viewed indicators, this-month won deals + estimated commission with the
  formula displayed (first-month margin on won quotes × settings percent,
  display-only).
- My customers: read-only 360 subset (services, invoice statuses only,
  conversations) strictly for assigned customers.

Verified in browser at 390px: rep captured "Nomsa Dube" → built a VoIP
quote with R100 discount → sent (Q-2026-00001, lead → quoted) → public
link viewed (status flip + rep bell) → accepted with OTP + address →
order NC-2026-00004 at the discounted R664 → simulated ITN → service
provisioning + customer attributed to Demo Rep + lead won. Floor check:
rep blocked at R200 discount on a no-cost line, admin override allowed.
Second rep (rep2) gets a 404 on rep1's lead URL. Typecheck/lint/29 tests
green.

## M8, Reports, reconciliation, hardening ✅ (2026-07-18)

Done:
- Reports (§6.4/§9.4.6): active services by category, margin by provider
  with missing-cost counts, activations vs cancellations (12 months),
  collections summary, "set cost prices" checklist linking to Catalogue;
  CSV export per report (/admin/reports/export) incl. age analysis.
- Reconciliation worksheet: provider selector, expected wholesale from
  active/suspended services, statement CSV upload
  (external_ref,amount) matched by external_ref, flags
  ok / missing_from_statement / amount_delta / no_cost_price plus leakage
  rows (on statement, not on platform); output is a CSV checklist , 
  nothing auto-adjusts.
- Settings: company + EFT banking editors (audited via updateSetting),
  read-only dunning timeline.
- Staff management: invite by email (Resend setup link, 7-day one-time
  token), /setup page (name + password + auto sign-in), role change and
  disable (self-protects; disabled users hard-blocked in proxy.ts).
- Integrations panel: PayFast / WhatsApp / Resend / SMS / Supabase /
  Inngest states from env (configured / sandbox / live / dev fallback),
  email + SMS test-send buttons.
- Notification template viewer (per-event rendered samples + Meta template
  names); audit log viewer with entity filters + before/after JSON.
- Trigram search migration (pg_trgm + GIN indexes on customer names/
  phone/company, invoice numbers, conversation subjects).
- design/IMAGE-MANIFEST.md (§11): every marketing slot with dimensions and
  art briefs, no stock photos in the build.
- Security pass: greps confirm no service keys/secrets or
  localStorage/sessionStorage in client code, and no service status writes
  outside the state machine (billing engine touches only plan/pointer
  columns). Webhooks signature-verified + idempotent (verified in M2/M5);
  OTP rate limits enforced (5/phone/hr, 15/IP/hr); signed URLs on all
  private files with audited RICA access.
- Playwright e2e (`tests/e2e/happy-path.spec.ts`, 390px viewport): signup
  wizard → OTP → order → simulated ITN → provisioning → admin completes
  the Today activation checklist → service active with billing dates →
  time-travelled billing run issues the anniversary invoice (R382, open)
  → manual EFT settles it. **4/4 passing** against the dev stack
  (`pnpm test:e2e`, needs E2E_ADMIN_PASSWORD from seed output).
- LAUNCH-CHECKLIST.md: honest client/dev split, pricing conflict, cost
  prices, PayFast own-account sandbox + live ITN test, Meta verification +
  template approval, SMS creds, Supabase project, Resend domain, Inngest
  keys, imagery, legal review, staging → DNS cutover with the Lovable site
  live until the switch, plus the documented deferrals.

State at M8 close: all milestones M0–M8 complete; typecheck, lint, 29
vitest tests, 4 Playwright tests green; production build verified in M1.
The platform is code-complete pending the launch checklist's real-world
credentials and client decisions.

## Design pass (post-M8, 2026-07-21)

Full visual overhaul of the public site, modelled on the photographic,
dark-hero style of the current needdconnect.co.za:

- Marketing imagery: 8 Freepik free-licence photos processed to webp via
  sharp (hero 1920w, rest 1200–1600w, all under 100KB) in
  `public/marketing/`; supersedes the no-stock-photos note in the M8
  image manifest at the client's request.
- Product photos: `scripts/fetch-product-images.ts` scrapes manufacturer
  og:image (Cudy sitemap, Yealink), validates at least 500px, flattens to
  white 1200x1200 webp, uploads to the catalogue bucket and points
  `hardware_products.image_path` at it. 12 SKUs have real photos on both
  dev and staging; the rest keep the honest "Image coming soon" card.
- Admin uploads: hardware editor accepts an image (min 800px wide,
  converted to webp, stored via the storage abstraction with signed
  URLs). Verified end to end with a headless-browser run: upload, save,
  editor preview and the public hardware card all serve the stored file.
- Home page rebuilt: full-bleed dark photo hero with scrim, trust chip,
  pill CTAs and a stat row; photo category cards; featured-plan cards
  with gradient top bar; photographic image band; steps, trust strip,
  FAQ cards and an ink CTA band.
- `PageHeader` photographic band applied to internet, fibre, voip,
  sim-data, hardware and coverage pages.
- Buttons are pill-shaped globally (`rounded-full` in the Button
  variants), radius scale raised (`--radius: 1rem`), `.card-hover`,
  `.img-zoom` and `.hero-scrim` utilities added.
- Scroll reveals: `components/shared/reveal.tsx`, an
  IntersectionObserver fade-and-rise wrapper with a scroll-position
  fallback and reduced-motion handling (motion/react whileInView proved
  unreliable, so reveals are hand-rolled). Verified headless at five
  scroll depths: no in-viewport element ever stays hidden.
- Em dashes removed across the whole platform (91 files swept, standing
  rule for all future copy).

Checks after the pass: typecheck, lint and all 29 vitest tests green.

## Platform enhancement rounds (post-M8, 2026-07-27)

A multi-agent audit and implementation loop against the brief "ultra premium,
top notch features, easy to use for all users". Ten specialist auditors produced
144 findings (19 critical, 60 high); three implementation rounds fixed them in
file-partitioned parallel batches, with typecheck, lint, unit and end-to-end
tests green at every commit.

### Correctness bugs found and fixed

- **parseZar read the app's own money format 100x wrong.** It stripped commas
  unconditionally, so "R1 234,56" (what formatCents prints, en-ZA) parsed as
  R123 456,00. It sits behind admin manual payment capture and catalogue cost
  entry, so an operator pasting a displayed amount would post a hundredfold
  payment. Now resolves the decimal separator by position and accepts both SA
  and international grouping. Locked in by tests that round-trip formatCents.
- **The payment webhook float-parsed money.** amount_gross went through
  parseFloat(x) * 100 on the one number that must be exact. Now parseZar, with
  an unreadable amount logged for reconciliation rather than booked at a guess.
- **Scroll reveals shipped opacity:0 in the server HTML**, so crawlers and any
  no-JS visitor received a blank page, against the rule that public pages render
  complete HTML server-side. The hidden state now lives in CSS behind
  `@media (scripting: enabled)`: no inline script, so no hydration mismatch.
- **APP_URL had eleven localhost fallbacks.** On the live domain a missing
  variable would silently ship localhost into the sitemap, canonicals,
  notification links and PayFast return URLs. lib/config.ts resolves it once and
  throws in production when unset or not https.
- **Quotes were marked accepted and leads won at order creation**, before any
  money landed, so abandoned checkouts counted as won revenue.
- **Portal balances ignored partial payments**, overstating what a customer owed.
- **PayFast return URLs were hardcoded to /signup/success**, so paying an invoice
  from the portal crashed on a page that could not find the order.
- **claimLeadAction had no authorize call, ownership guard or audit row.**
- **proxy.ts dropped the query string** when bouncing to login, losing deep links.
- Admin and sales detail routes now 404 on a malformed id instead of letting
  Postgres throw on an invalid uuid.

### Product and design

- Twelve public pages that had missed the design pass gained photographic header
  bands, one CTA and card language, and a proper reading measure. Real 1200x630
  Open Graph image, BreadcrumbList / Product / Offer / FAQ structured data.
- The mobile header drops from about 110px to 65px: the horizontally scrolling
  pill strip becomes a full-height ink sheet that traps focus, closes on Escape
  and on route change, and falls back to a plain link list without JavaScript.
- Signup states what is charged today versus monthly, itemises the once-off fee,
  keeps input on validation errors, and offers OTP resend with an expiry
  countdown. Sign-in reached the same standard and honours the deep link.
- Admin Today became a triage queue with counted filter chips; Billing gained
  search (the trigram indexes existed and were unused), invoice void and
  write-off, and an outstanding column.
- WhatsApp links are validated against real SA mobile ranges. The seeded
  086 share-call number cannot receive WhatsApp, so the affordance stays hidden
  until `company.whatsapp` is set in Settings.
- Accessibility: WCAG focus ring with an ink-surface variant, skip links and main
  landmarks on all four shells, accessible names on icon-only navigation, and a
  44px coarse-pointer floor via pointer-coarse variants that leaves desktop
  density untouched.

State: typecheck, lint, 42 vitest tests and 4 Playwright end-to-end tests green.
Two harness bugs were fixed along the way: simulate-itn.ts hardcoded port 3000
(delivering the ITN to an unrelated app when that port was taken), and the pay
button matcher expected an unlocalised amount.
