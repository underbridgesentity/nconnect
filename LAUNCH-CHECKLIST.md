# Needd Connect, launch checklist

Honest state of what must happen between this build and taking live traffic
on needdconnect.co.za. Items marked **client** need Needd's people; items
marked **dev** are configuration/deploy work.

## Go-live configuration (do these first)

- [x] **dev: `APP_URL` set to `https://www.needdconnect.co.za`** in Vercel
      production (2026-08-05) and verified live: the canonical on the home page
      now names the real domain, so PayFast returns, emailed links and SEO all
      agree with the host customers are on.
      This is now the single source for canonical URLs, the sitemap, every
      notification link, staff setup links and PayFast's return, cancel and
      notify URLs. `lib/config.ts` throws at first use in production if it is
      unset or not https, so a missing value fails the deploy loudly instead
      of silently shipping localhost links to customers.
- [ ] **client, optional: Set the WhatsApp number** in Settings, Company
      details. No longer a launch blocker, see the WhatsApp section below.
      wa.me cannot deliver to the seeded 086 share-call number, so the WhatsApp
      buttons stay hidden until a real mobile (06x, 07x, 081 to 084) is saved.
      Leaving it blank is a valid launch state: nothing breaks and no affordance
      renders. This is the switch that turns WhatsApp on when the business is
      ready for it.

- [x] **dev: Resend sending domain verified.** `needdconnect.co.za` returns
      `status=verified` on the account, and `EMAIL_FROM=hello@needdconnect.co.za`
      matches it. Checked against the Resend API, not assumed.
- [x] **dev: `RESEND_API_KEY` set in Vercel production** (2026-08-05) and
      verified live: a sign-in code requested on www.needdconnect.co.za was
      created and reported delivered by the Resend API.
- [ ] **dev: One real inbox test before launch.** Domain verification proves DNS
      is right, not that mail lands in an inbox. Send a sign-in code to a Gmail,
      an Outlook and a corporate address and confirm none are filed as spam.
      **This gates every account**: customers sign in with an emailed code, so
      mail that does not arrive means nobody can sign up or sign in at all.
- [ ] **dev: Rotate the Resend key before launch.** The current key was shared
      in a chat transcript, so treat it as disclosed: issue a fresh one from the
      Resend dashboard, set it in Vercel, and revoke the old one.

## Money and catalogue

- [x] **client: VAT questions answered (2026-08-05).** Needd IS VAT
      registered, catalogue prices ARE VAT inclusive, and the rate is 15%
      (1500 basis points). Recorded here because the figures on every invoice
      depend on all three, and a later change of any one of them must be a
      deliberate decision rather than a quiet edit.
- [ ] **dev: Set the `vat` setting in production** once the VAT build is
      deployed: `{ registered: true, rateBasisPoints: 1500,
      pricesIncludeVat: true }`. Until it is set the system stays honest but
      VAT-free: no VAT line, and the VAT registration number does not print,
      which is correct because an invoice showing a VAT number with no
      breakdown is not a valid tax invoice.
      The rate is snapshotted onto each invoice at issue time, so setting this
      changes future invoices only and never rewrites history.

- [ ] **client: Confirm hardware retail pricing conflict.** The previous
      live site sold some routers higher than the May 2026 catalogue now
      seeded: Cudy GP1200 R999 vs R417, GP3000 R1 499 vs R550, LT500
      R1 299 vs R640, LT500 Outdoor R2 199 vs R1 056. Decide, then edit in
      Catalogue → Hardware.
- [ ] **client: Fill wholesale cost prices** for every plan and hardware
      item (Catalogue UI). The Reports tab lists what's missing; margin
      reporting and quote floors are blind until this is done.
- [ ] **client: Confirm fibre once-off/installation fees** per FNO
      (seeded R0) before relying on fibre checkout.
- [ ] **client: Set real hardware stock levels** (seeded 0, threshold 3).
- [ ] **client: EFT banking details** in Settings (placeholders shipped);
      they print on unpaid invoice PDFs.

## Payments (PayFast)

- [x] **client: PayFast account credentials supplied** (merchant id, merchant
      key, security passphrase from Developer Settings). Held in `.env.local`
      for local work; never committed (`.env*` is gitignored).
- [x] **dev: Merchant id, key and passphrase set in Vercel production**
      (2026-08-05). `PAYFAST_MODE` stays `sandbox` until the first live test.
      Verified as far as sandbox allows: a full signup on the live domain
      builds and submits the signed form, and the sandbox answers "signature
      does not match", which is the documented behaviour for LIVE merchant
      credentials posted at the sandbox host (the shared sandbox does not know
      this merchant). It does not indicate a bad passphrase. The real proof is
      the first live checkout below.
- [ ] **client: Confirm the passphrase was saved in the PayFast dashboard.**
      The screenshot shared on 2026-07-27 showed it typed into Developer
      Settings with Save not yet clicked. If the dashboard value differs from
      the deployed one, every live checkout fails with the same signature
      error, so this is worth thirty seconds before the live test.

- [x] **dev: `PAYFAST_MODE` flipped to `live`** (2026-08-05, client
      instruction) and verified to the edge of moving money: a checkout on
      www.needdconnect.co.za now posts to www.payfast.co.za and the LIVE host
      accepts the signature (the sandbox-era "signature does not match" is
      gone, and PayFast validates the signature before anything else). The
      merchant id, key and passphrase are therefore all correct in production.
- [ ] **client, BLOCKING: Enable the PayFast account to receive payments.**
      The live host currently answers: "The merchant cannot accept these kind
      of payments at the moment." That is an account-status message, not a
      code or configuration problem, and only the account holder can clear it
      in the PayFast dashboard. Usual causes: account verification (FICA
      documents, bank confirmation) not finished, or card payments not enabled
      on the account. Until it is cleared, every checkout fails at PayFast.
- [ ] **client+dev: First real checkout and refund** once the account can
      accept payments: one low-value order end to end (ITN will fire at
      https://www.needdconnect.co.za/api/webhooks/payfast), then refund it in
      the PayFast dashboard.
- [ ] **dev: Live-mode ITN test** after DNS cutover (ITN needs a public
      URL; sandbox cannot reach localhost, `scripts/simulate-itn.ts`
      covers dev).
- [ ] **dev: Confirm tokenisation** (card charge on file) against the
      client's account settings; the ad-hoc token endpoint requires the
      feature enabled on the PayFast account.
      **Verify the API signature specifically.** The tokenisation API signs
      differently from the redirect form: header and body fields *and* the
      passphrase are sorted alphabetically together, where the redirect appends
      the passphrase last. `chargeToken` was appending it and is now sorting it,
      but that path cannot be exercised without a real stored token, so the
      first live ad-hoc charge must be watched. A signature mismatch there
      fails every recurring collection while leaving first payments working,
      so it would surface a month after launch rather than on day one.

## WhatsApp (Meta Cloud API), deferred to a later stage

The client's decision (2026-07-29): accounts are email-based and WhatsApp is
added properly later rather than being the headline channel. None of the items
below block launch. Email carries every notification today, and the WhatsApp
affordances stay hidden until a real mobile number is saved in Settings, so
nothing is broken while this section is untouched.


- [ ] **client: Meta Business verification** for Needd Technology
      Solutions and a WhatsApp Business number.
- [ ] **client/dev: Template approval** for the names in
      `lib/notify/templates.ts` (otp_login, order_confirmed,
      service_provisioning, service_activated, invoice_issued,
      payment_received, payment_failed, past_due_warning,
      service_suspended, service_reactivated, cancellation_scheduled,
      service_cancelled, quote_sent, feasibility_result).
- [ ] **dev: Set WHATSAPP_* env + WHATSAPP_ENABLED=true**; until then
      every event reaches customers by email (verified).
- [ ] **dev: Point the Meta webhook** at /api/webhooks/whatsapp with the
      verify token.

## Decisions taken, do not re-litigate

- **Accounts are email-based, WhatsApp comes later (2026-07-29).** Customers
  sign in with a six-digit one-time code sent to their email address. There are
  no customer passwords, so there is no reset flow to build or attack, and the
  existing OTP protections carry over unchanged: codes hashed at rest, a five
  minute expiry, a sixty second resend cooldown, five verify attempts per code,
  and per-address and per-IP hourly rate limits.
  A phone number is still required at signup because RICA requires one for any
  SIM-based service. It is simply no longer the login credential.
  The consequence worth remembering: email deliverability now gates every
  account, so the Resend domain is a hard launch blocker rather than a nicety.

- **Cloudflare instead of Vercel: considered and declined (2026-07-28).**
  Three dependencies cannot run on Cloudflare Workers: `sharp` (native libvips,
  used by the admin catalogue and portal attachment uploads), `@node-rs/argon2`
  (native Rust, hashes every staff password, and swapping the implementation
  risks invalidating existing hashes), and `@react-pdf/renderer` for invoices.
  Compute is already pinned to `cpt1` (Cape Town), so moving it to an edge
  runtime wins nothing: the latency that customers actually feel comes from the
  database sitting in eu-west-2 (London), roughly 150 to 180ms per query, and
  the pages run several queries each.
  **The change worth investigating instead is a Postgres region closer to South
  Africa**, since Supabase no longer offers af-south-1 for new projects.
  If edge protection is wanted later, the low-risk shape is Cloudflare DNS plus
  proxy in front of Vercel, with cache rules bypassing `/_next/*` so Vercel keeps
  owning ISR, and edge rate limiting on the OTP endpoints and the PayFast
  webhook. Note that OTP rate limiting is currently database-backed, so every
  abusive request costs a London round trip just to be rejected. Check what
  Vercel's own firewall already covers before paying for overlap.

## Messaging / infrastructure

- [ ] **client: SMS provider account** (SMSPortal or Clickatell) +
      `SMS_PROVIDER`/`SMS_API_KEY`, OTP fallback channel.
- [ ] **dev: Supabase project (af-south-1 is no longer offered for new
      projects; staging used eu-west-2, see the region note above)**: run
      migrations against the
      pooler URL, create buckets `catalogue` (public), `compliance`,
      `documents` (private), set SUPABASE_* env. Storage and realtime
      drivers switch over automatically; the dev fallbacks
      (.uploads/ + 5s polling) retire by themselves.
- [ ] **dev: Inngest account** + event/signing keys; verify the
      billing-run cron fires 02:00 Africa/Johannesburg.
- [ ] **dev: Vercel project** pinned to cpt1 (vercel.json committed), env
      vars set, staging subdomain first.
- [ ] **dev: Production seed**: `pnpm seed` (no --dev) seeds catalogue +
      invited admin only; send the admin setup link from Staff tab.

## Brand and content

- [ ] **client: Confirm accent colour**: #136FB0 was sampled from the
      logo pack ("N" blue); ink navy #121829.
- [ ] **client: Hero/marketing imagery** per `design/IMAGE-MANIFEST.md`
      (Freepik); components fall back to designed gradients until then.
- [ ] **client: Hardware product photography** (press images) via the
      Catalogue uploader (min 800px, auto-webp).
- [ ] **client: Legal copy review** (privacy/POPIA/terms/RICA pages) by
      the client's attorney.

## Verification before cutover

- [ ] **dev: Playwright happy-path e2e** (spec `tests/e2e/happy-path.spec.ts`)
      against staging with client sandbox credentials.
- [ ] **dev: Lighthouse mobile ≥ 90** on Home and category pages
      (structurally in place: SSG/ISR, self-hosted fonts, minimal JS).
- [ ] **dev: Rate-limit smoke test** on /login OTP (5/phone/hour,
      15/IP/hour enforced in code).
- [ ] **client+dev: DNS cutover plan**: staging verified → point
      needdconnect.co.za at Vercel; the old Lovable site stays live until
      the switch.

## Known deferred items (documented in PROGRESS.md)

- Reactivation fee line (settings key exists, not charged).
- Customer CSV import UI (export shipped; import on request).
- Card replacement outside a payment (PayFast has no charge-free
  tokenisation; replacement happens on the next online payment).
- MRR trend chart (movement table shipped; chart once real months of data
  exist, no fake charts, ever).
