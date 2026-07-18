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

## M2 — Signup, orders, payments-in (next)

- [ ] 3-step wizard with server-held draft, OTP account creation, RICA
      capture to compliance bucket, PayFast sandbox checkout + idempotent
      ITN webhook, order snapshots, receipts, abandoned-lead capture.
