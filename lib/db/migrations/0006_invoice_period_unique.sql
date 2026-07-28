-- Double-billing backstop (spec §6.1).
--
-- runInvoiceGeneration is idempotent by reading for an existing invoice on
-- (service_id, period_start) and inserting when there is none, and it now takes
-- SELECT ... FOR UPDATE on the service row so two overlapping runs serialise.
-- That closes the race in application code, but application code is the wrong
-- place for the last line of defence: a future caller, a manual insert or a
-- retry that skips the lock could still bill a customer twice for one month,
-- and an over-billed customer is the most expensive kind of bug this system
-- can have.
--
-- Partial, because adjustment invoices (plan changes) and order invoices carry
-- no service_id or no period_start and are legitimately many per service.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_service_period_unique
  ON invoices (service_id, period_start)
  WHERE service_id IS NOT NULL AND period_start IS NOT NULL;
