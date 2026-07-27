# Needd Connect — launch checklist

Honest state of what must happen between this build and taking live traffic
on needdconnect.co.za. Items marked **client** need Needd's people; items
marked **dev** are configuration/deploy work.

## Money and catalogue

- [ ] **client — Confirm hardware retail pricing conflict.** The previous
      live site sold some routers higher than the May 2026 catalogue now
      seeded: Cudy GP1200 R999 vs R417, GP3000 R1 499 vs R550, LT500
      R1 299 vs R640, LT500 Outdoor R2 199 vs R1 056. Decide, then edit in
      Catalogue → Hardware.
- [ ] **client — Fill wholesale cost prices** for every plan and hardware
      item (Catalogue UI). The Reports tab lists what's missing; margin
      reporting and quote floors are blind until this is done.
- [ ] **client — Confirm fibre once-off/installation fees** per FNO
      (seeded R0) before relying on fibre checkout.
- [ ] **client — Set real hardware stock levels** (seeded 0, threshold 3).
- [ ] **client — EFT banking details** in Settings (placeholders shipped);
      they print on unpaid invoice PDFs.

## Payments (PayFast)

- [x] **client — PayFast account credentials supplied** (merchant id, merchant
      key, security passphrase from Developer Settings). Held in `.env.local`
      for local work; never committed (`.env*` is gitignored).
- [ ] **dev — Set the same three values in Vercel** for the production
      environment, then redeploy. The passphrase is required: without it the
      signature PayFast expects differs and every checkout is rejected with
      "signature does not match".

      ```bash
      vercel env add PAYFAST_MERCHANT_ID production
      vercel env add PAYFAST_MERCHANT_KEY production
      vercel env add PAYFAST_PASSPHRASE production
      vercel env add PAYFAST_MODE production   # value: live
      ```

- [ ] **client — Confirm the PayFast account is live-enabled** and that the
      notify URL `https://needdconnect.co.za/api/webhooks/payfast` is
      whitelisted if the account restricts ITN destinations.
- [ ] **dev — Flip `PAYFAST_MODE` to `live`** only once DNS resolves and one
      real low-value checkout has been completed and refunded.
- [ ] **dev — Live-mode ITN test** after DNS cutover (ITN needs a public
      URL; sandbox cannot reach localhost, `scripts/simulate-itn.ts`
      covers dev).
- [ ] **dev — Confirm tokenisation** (card charge on file) against the
      client's account settings; the ad-hoc token endpoint requires the
      feature enabled on the PayFast account.

## WhatsApp (Meta Cloud API)

- [ ] **client — Meta Business verification** for Needd Technology
      Solutions and a WhatsApp Business number.
- [ ] **client/dev — Template approval** for the names in
      `lib/notify/templates.ts` (otp_login, order_confirmed,
      service_provisioning, service_activated, invoice_issued,
      payment_received, payment_failed, past_due_warning,
      service_suspended, service_reactivated, cancellation_scheduled,
      service_cancelled, quote_sent, feasibility_result).
- [ ] **dev — Set WHATSAPP_* env + WHATSAPP_ENABLED=true**; until then
      every event reaches customers by email (verified).
- [ ] **dev — Point the Meta webhook** at /api/webhooks/whatsapp with the
      verify token.

## Messaging / infrastructure

- [ ] **client — SMS provider account** (SMSPortal or Clickatell) +
      `SMS_PROVIDER`/`SMS_API_KEY` — OTP fallback channel.
- [ ] **dev — Resend domain** (SPF/DKIM for needdconnect.co.za) +
      RESEND_API_KEY.
- [ ] **dev — Supabase project (af-south-1)**: run migrations against the
      pooler URL, create buckets `catalogue` (public), `compliance`,
      `documents` (private), set SUPABASE_* env. Storage and realtime
      drivers switch over automatically; the dev fallbacks
      (.uploads/ + 5s polling) retire by themselves.
- [ ] **dev — Inngest account** + event/signing keys; verify the
      billing-run cron fires 02:00 Africa/Johannesburg.
- [ ] **dev — Vercel project** pinned to cpt1 (vercel.json committed), env
      vars set, staging subdomain first.
- [ ] **dev — Production seed**: `pnpm seed` (no --dev) seeds catalogue +
      invited admin only; send the admin setup link from Staff tab.

## Brand and content

- [ ] **client — Confirm accent colour**: #136FB0 was sampled from the
      logo pack ("N" blue); ink navy #121829.
- [ ] **client — Hero/marketing imagery** per `design/IMAGE-MANIFEST.md`
      (Freepik); components fall back to designed gradients until then.
- [ ] **client — Hardware product photography** (press images) via the
      Catalogue uploader (min 800px, auto-webp).
- [ ] **client — Legal copy review** (privacy/POPIA/terms/RICA pages) by
      the client's attorney.

## Verification before cutover

- [ ] **dev — Playwright happy-path e2e** (spec `tests/e2e/happy-path.spec.ts`)
      against staging with client sandbox credentials.
- [ ] **dev — Lighthouse mobile ≥ 90** on Home and category pages
      (structurally in place: SSG/ISR, self-hosted fonts, minimal JS).
- [ ] **dev — Rate-limit smoke test** on /login OTP (5/phone/hour,
      15/IP/hour enforced in code).
- [ ] **client+dev — DNS cutover plan**: staging verified → point
      needdconnect.co.za at Vercel; the old Lovable site stays live until
      the switch.

## Known deferred items (documented in PROGRESS.md)

- Reactivation fee line (settings key exists, not charged).
- Customer CSV import UI (export shipped; import on request).
- Card replacement outside a payment (PayFast has no charge-free
  tokenisation; replacement happens on the next online payment).
- MRR trend chart (movement table shipped; chart once real months of data
  exist — no fake charts, ever).
