-- Public account tables for the "Get early access" flow.
-- Password hashes are kept separate from the signups table so the internal
-- signups viewer never exposes credentials.

BEGIN;

CREATE TABLE IF NOT EXISTS public_users (
    email         TEXT PRIMARY KEY REFERENCES signups(email) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_sessions (
    token_hash TEXT PRIMARY KEY,
    email      TEXT NOT NULL REFERENCES public_users(email) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS public_sessions_expires_at_idx
    ON public_sessions (expires_at);

-- The internal signups viewer needs read access; the API still only writes
-- signups through the existing signup endpoint.
GRANT SELECT ON signups TO signup_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public_users TO signup_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public_sessions TO signup_api;

COMMIT;
