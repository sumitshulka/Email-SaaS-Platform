-- Drizzle describes the dependent index but does not install extension dependencies.
-- Enable pg_trgm in each database before synchronizing that index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
