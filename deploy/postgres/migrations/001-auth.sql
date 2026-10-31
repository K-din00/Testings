-- Internal auth tables for the Apex console.
-- Run as the database owner (myapp_user), then the API user (signup_api)
-- receives only the DML privileges it needs.

BEGIN;

CREATE TABLE IF NOT EXISTS internal_users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'Administrator',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internal_sessions (
    token_hash TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES internal_users(username) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS internal_sessions_expires_at_idx
    ON internal_sessions (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON internal_users TO signup_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON internal_sessions TO signup_api;

COMMIT;
