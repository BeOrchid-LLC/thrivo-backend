-- Bootstrap extensions. Hand-authored (drizzle-kit does not emit CREATE EXTENSION).
-- Must run before any table using the citext type. Ordered first via the journal.
CREATE EXTENSION IF NOT EXISTS citext;
