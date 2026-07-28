# Needd Connect working rules

Read SPEC.md (locked decisions) and PROGRESS.md (current state) first.

- Build strictly in milestone order (M0–M8); update PROGRESS.md after each.
- All money is integer cents via `lib/money`, never float maths on money.
- Every domain mutation: zod → `authorize()` → transaction → `writeAudit` →
  `emitDomainEvent` (outbox). No status writes outside the state machine.
- Timestamps UTC in the DB, displayed Africa/Johannesburg.
- Never render fake data; design honest empty states instead.
- Public pages must render complete HTML server-side.
- Checks before any commit: `pnpm typecheck && pnpm lint && pnpm test`.
