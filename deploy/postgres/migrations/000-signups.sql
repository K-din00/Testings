-- Base early-access signups table.
-- Run as the database owner (myapp_user) before 001-auth.sql.
-- gen_random_uuid() is built into PostgreSQL 13+; no extension is required.

BEGIN;

CREATE TABLE IF NOT EXISTS signups (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT NOT NULL UNIQUE,
    fields     JSONB NOT NULL DEFAULT '{}'::jsonb,
    meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The public signup endpoint only needs to add rows. The internal signups
-- viewer gets SELECT through 002-public-auth.sql.
GRANT SELECT, INSERT ON signups TO signup_api;

COMMIT;
