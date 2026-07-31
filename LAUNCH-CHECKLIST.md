# Needd Connect, launch checklist

Honest state of what must happen between this build and taking live traffic
on needdconnect.co.za. Items marked **client** need Needd's people; items
marked **dev** are configuration/deploy work.

## Go-live configuration (do these first)

- [ ] **dev: Set `APP_URL=https://needdconnect.co.za`** in Vercel production.
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

- [ ] **dev: Verify the Resend sending domain** (SPF and DKIM for
      needdconnect.co.za) and set `RESEND_API_KEY`.
      **This now gates every account.** Customers sign in with a one-time code
      sent by email, so if mail does not deliver, nobody can sign up or sign in
      at all. It was a soft dependency while accounts were phone-based; it is a
      hard launch blocker now. Send a real test to a Gmail, an Outlook and a
      corporate address before launch, and check none of them land in spam.

## Money and catalogue

- [ ] **client + dev: VAT treatment: invoices are not currently valid tax
      invoices.** The company VAT number is seeded and prints on every invoice
      footer, and the terms page says prices are "Rands including VAT where
      applicable", but nothing in the system computes VAT: there is no rate, no
      VAT amount and no exclusive/inclusive split on an invoice or its line
      items. A South African tax invoice must show the VAT amount and rate, so
      printing a VAT number beside a total with no breakdown is worse than
      printing neither.
      The client must confirm three things before this can be built: whether
      Needd is VAT registered, whether catalogue prices are VAT inclusive
      (they read as inclusive today), and the rate to apply. Then it needs
      `vat_rate_basis_points` and `vat_cents` on invoices and invoice lines, the
      split computed in integer cents through `lib/money` (inclusive VAT is
      `total * rate / (100 + rate)`, never a float), and the invoice PDF and
      portal updated to show subtotal, VAT and total. Do not guess the rate.

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
- [ ] **dev: Set the same three values in Vercel** for the production
      environment, then redeploy. The passphrase is required: without it the
      signature PayFast expects differs and every checkout is rejected with
      "signature does not match".

      ```bash
      vercel env add PAYFAST_MERCHANT_ID production
      vercel env add PAYFAST_MERCHANT_KEY production
      vercel env add PAYFAST_PASSPHRASE production
      vercel env add PAYFAST_MODE production   # value: live
      ```

- [ ] **client: Confirm the PayFast account is live-enabled** and that the
      notify URL `https://needdconnect.co.za/api/webhooks/payfast` is
      whitelisted if the account restricts ITN destinations.
- [ ] **dev: Flip `PAYFAST_MODE` to `live`** only once DNS resolves and one
      real low-value checkout has been completed and refunded.
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
