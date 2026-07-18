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

## M1 — Catalogue + public site (next)

- [ ] Admin Catalogue area (plans/hardware/bundles, publish flow, image
      upload → webp, PDF catalogue)
- [ ] Public site §9.1 fully server-rendered from the DB with SEO
      (sitemap, robots, JSON-LD, OG images, ISR + revalidation on publish)
