-- Production test-data wipe (client instruction 2026-08-05).
-- This database becomes production: every customer, order and trace of test
-- traffic goes. What STAYS: providers, plans, hardware_products, bundles,
-- bundle_items, settings, and the two staff accounts (admin@, rep@).
--
-- Run in the Supabase SQL editor (project nbrnvkkuduucrbznuhyw) or psql.
-- One transaction, children before parents, so it either all lands or nothing
-- does and no foreign key is ever left dangling.

BEGIN;

DELETE FROM collection_attempts;
DELETE FROM payments;
DELETE FROM invoice_lines;
DELETE FROM invoices;
DELETE FROM provisioning_tasks;
DELETE FROM sims;
DELETE FROM services;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM quote_items;
DELETE FROM quotes;
DELETE FROM lead_activities;
DELETE FROM leads;
DELETE FROM messages;
DELETE FROM conversations;
DELETE FROM notifications;
DELETE FROM payment_methods;
DELETE FROM rica_records;
DELETE FROM addresses;
DELETE FROM consents;
DELETE FROM signup_drafts;
DELETE FROM otp_codes;
DELETE FROM invite_tokens;
DELETE FROM audit_log;
DELETE FROM domain_events;
DELETE FROM customers;
DELETE FROM users WHERE role = 'customer';

-- Numbering restarts at NC-2026-00001 for the first real customer. Safe once
-- the tables holding the old numbers are empty; the only artifacts carrying
-- them went to resend.dev test inboxes. The column is last_value, not counter:
-- verified against information_schema rather than assumed, after the first
-- attempt failed on exactly that guess and rolled the whole transaction back.
DELETE FROM number_sequences;

COMMIT;

-- Afterwards, these should be the survivors:
--   select count(*) from plans;              -- 26
--   select count(*) from hardware_products;  -- 20
--   select count(*) from providers;          -- 8
--   select email, role from users;           -- admin@ and rep@ only
