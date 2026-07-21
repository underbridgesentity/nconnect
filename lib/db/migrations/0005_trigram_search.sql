-- §10.3 search: ILIKE + trigram indexes, no external search service.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS customers_first_name_trgm ON customers USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_last_name_trgm ON customers USING gin (last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_company_trgm ON customers USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_phone_trgm ON customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoices_number_trgm ON invoices USING gin (number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS conversations_subject_trgm ON conversations USING gin (subject gin_trgm_ops);
