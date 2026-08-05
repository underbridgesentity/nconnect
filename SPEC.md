# Needd Connect: Full Platform Build Specification

**Handover prompt | Version 1.0 | July 2026**
**Client:** Needd Technology Solutions (Pty) Ltd | **Domain:** needdconnect.co.za (production), staging on a subdomain
**Prepared by:** Under Bridges Entity

> This file is the single source of truth for the build. The full specification
> was delivered as the project handover prompt; the complete text lives with
> the client. This copy records the locked decisions the codebase is built to.

## Locked stack (§3)

Next.js (App Router, RSC, TS strict) · Tailwind + shadcn/ui (restyled) ·
Supabase Postgres af-south-1 via Drizzle over the pooler · Auth.js v5 (JWT;
customers email-OTP per the 2026-07-29 client decision, phone kept for RICA
contact only, staff argon2 passwords) · Supabase Storage (catalogue
public, compliance/documents private + signed URLs) · Supabase Realtime
(server-minted scoped tokens) · Inngest (billing cron, dunning, lifecycle,
notifications, outbox) · PayFast (redirect + ITN + tokenisation, sandbox
first) · Resend · Meta WhatsApp Cloud API (env-gated, email fallback) ·
pluggable SMS adapter (console driver in dev) · @react-pdf/renderer ·
Framer Motion · Zod at every boundary · Vercel cpt1 · PWA manifest + SW.

## Non-negotiables (§16 guardrails)

1. No fake data, charts, or activity anywhere, ever.
2. All money is integer cents (ZAR) through `lib/money`; no float money maths.
3. No DB keys/secrets client-side; no localStorage auth.
4. No service status writes outside the state machine; no deletes on financial/lifecycle records.
5. Webhooks idempotent + signature-verified before side effects.
6. Every domain mutation: zod → authorize → transaction → audit → event.
7. Public site renders complete HTML server-side.
8. Portal and admin fully usable at 390px.
9. Plain, warm, specific copy; no lorem ipsum.
10. Blocked integrations are built against sandbox/mocks behind env flags and recorded in PROGRESS.md; success states are never faked.

## Key structures

- Three roles: `admin`, `sales`, `customer`; capability map in `lib/auth/permissions.ts` (§12).
- The **Service** is the core object; lifecycle state machine in `lib/domain/services.ts` (§5).
- Billing: anniversary billing on `billing_anchor_day` (clamped to 28), first month paid at checkout, `next_invoice_date` set on activation, daily 02:00 Africa/Johannesburg cron, dunning 0/2/5/7/10/40 (§6).
- Provider connectors: `ProviderConnector` interface with ManualConnector creating provisioning tasks (§7).
- Notification matrix (§8): WhatsApp templates + email + bell via a single `notify()` dispatcher; email fallback when WhatsApp disabled.
- Compliance: POPIA (consents, AES-256-GCM ID numbers, af-south-1 residency) and RICA (blocking activation checklist, 5-year retention) (§13).
- Milestones M0–M8 with acceptance criteria (§15); build strictly in order; PROGRESS.md updated per milestone.
