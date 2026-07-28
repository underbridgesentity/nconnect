# Needd Connect

The operating platform for Needd Technology Solutions' connectivity reseller
business: public acquisition site, customer self-service portal, admin
operations system (CRM, catalogue, billing, support) and sales workspace , 
one Next.js codebase.

- **Spec:** [SPEC.md](SPEC.md) (locked decisions), the full handover spec is the source of truth
- **Progress:** [PROGRESS.md](PROGRESS.md) (per-milestone log + open client items)

## Stack

Next.js (App Router, RSC) · TypeScript strict · Tailwind + shadcn/ui ·
Drizzle ORM on Supabase Postgres (af-south-1) · Auth.js v5 · Inngest ·
PayFast · Resend · Meta WhatsApp Cloud API · Vercel (cpt1).

## Development

```bash
pnpm install
cp .env.example .env.local        # fill DATABASE_URL etc.
createdb nconnect_dev             # or point DATABASE_URL at Supabase
pnpm db:migrate                   # apply Drizzle migrations
pnpm seed:dev                     # catalogue + dev logins (printed to console)
pnpm dev
```

- Staff sign-in: `/staff-login` (dev credentials printed by `pnpm seed:dev`)
- Customer sign-in: `/login`, OTP prints to the dev server console
  (`SMS_PROVIDER=console`)

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All money is integer cents through `lib/money`. Every state-changing
operation flows through a domain service: zod → authorize → transaction →
audit log → domain event (outbox → Inngest).
