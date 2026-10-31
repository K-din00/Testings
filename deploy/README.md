# Apex deployment

This directory contains the sources needed to rebuild the live Apex stack:
Caddy (TLS + static site), the Express API, and PostgreSQL.

```
deploy/
├── api/                  Express API and password-rotation script
├── web/                  Caddyfile and Compose stack for Caddy + API
└── postgres/             PostgreSQL Compose stack, bootstrap, migrations
```

Real `.env` files, database backups, and TLS keys are intentionally excluded
from Git. Only `.env.example` files are tracked.

## Prerequisites

- Docker Engine with the Compose plugin
- Ports 80 and 443 reachable from the internet
- A DNS record for the hostname in `deploy/web/Caddyfile`
- A strong password manager for the values below

## 1. Start PostgreSQL

```bash
cd deploy/postgres
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD and the owner DATABASE_URL.
docker compose up -d
```

The Compose project must be named `postgres` so the shared network is called
`postgres_database` (the web stack expects that name). Running the commands from
`deploy/postgres` does this automatically.

## 2. Create roles and the application database

```bash
cd deploy/postgres
cp bootstrap.sql.example bootstrap.sql
# Edit bootstrap.sql: replace CHANGE_ME_OWNER and CHANGE_ME_API.
docker exec -i postgres-db-1 \
  psql -U postgres -d postgres < bootstrap.sql
```

This creates:

- `myapp_user` — owns the `myapp` database and schema objects
- `signup_api` — least-privilege role used by the API
- `myapp` — the application database

The script is safe to re-run; it updates both role passwords.

## 3. Apply migrations

Run the migrations in order as the database owner:

```bash
cd deploy/postgres
for f in migrations/000-signups.sql migrations/001-auth.sql migrations/002-public-auth.sql; do
  docker exec -i postgres-db-1 psql -U myapp_user -d myapp < "$f"
done
```

The migrations create the signups table, internal auth tables, public account
tables, and the grants used by the API.

## 4. Configure and start the API + Caddy

```bash
cd deploy/api
cp .env.example .env
# Edit .env: set DATABASE_URL to the signup_api password from step 2.
# Keep COOKIE_SECURE=true in production.

cd ../web
SITE_ROOT=/opt/website docker compose up -d --build
```

`SITE_ROOT` is the directory containing `index.html`, `login.html`, and the
other static files. It defaults to `/opt/website`. If the repository is cloned
elsewhere, pass its absolute path:

```bash
SITE_ROOT="$(git rev-parse --show-toplevel)" docker compose up -d --build
```

Caddy builds the API from `../api`, reads its environment from
`../api/.env`, and joins the external `postgres_database` network.

## 5. Set the internal admin password

The API image includes the password-rotation script:

```bash
docker exec -w /app web-api-1 \
  node scripts/set-password.js admin 'replace-with-a-strong-password'
```

This creates the `admin` internal user or updates its password. Passwords are
stored as scrypt hashes in PostgreSQL; plaintext passwords are never written to
the database.

## Sessions and access control

| Session | Cookie | Idle expiry |
| --- | --- | --- |
| Internal console | `apex_session` | 1 hour, sliding on every authenticated request |
| Public early access | `apex_user_session` | 15 minutes, sliding on every authenticated request |

Both cookies are `HttpOnly` and `SameSite=Lax`. Set `COOKIE_SECURE=true` so they
are also `Secure` behind Caddy's TLS termination.

Caddy uses `forward_auth` to gate:

- `/internal.html` — internal console
- `/signups` and `/signups.html` — internal signups viewer
- `/account` and `/account.html` — public early-access page

## Password rotation

Internal admin:

```bash
docker exec -w /app web-api-1 \
  node scripts/set-password.js admin 'new-password'
```

API database role:

```sql
ALTER ROLE signup_api WITH PASSWORD 'new-password';
```

Then update `deploy/api/.env` and recreate the API:

```bash
cd deploy/web
docker compose up -d api
```

## Backups

Database backups belong in `deploy/postgres/backups/`, which is ignored by Git.
Never commit `.sql.gz` dumps, `.env` files, or private keys.

## Notes

- The signups table stores only the submitted email, JSON fields, metadata, and
  timestamp. Public passwords live in `public_users` as scrypt hashes.
- The internal signups viewer reads the table through
  `GET /api/internal/signups`; it never exposes password hashes.
- The first password entered for an email that is already on the signup list
  creates the public account. Later entries sign in with the same password.
