"use strict";

const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");
const { hashPassword, verifyPassword } = require("./password");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const INTERNAL_COOKIE = "apex_session";
const PUBLIC_COOKIE = "apex_user_session";
const INTERNAL_TTL_MS = 60 * 60 * 1000; // 1 hour, sliding on activity
const PUBLIC_TTL_MS = 15 * 60 * 1000; // 15 minutes, sliding on activity

// A valid scrypt hash of a random value, used to keep unknown-user logins
// on the same timing path as known-user logins.
const DUMMY_HASH =
  "scrypt$16384$8$1$oTZPA37MKmGlnnbbtTgCAg==$qIs5Ajp6AobEAT4ilkVsOpoxsGamk5OHAc98jMXTXt9PXiyQ+MSRd13/g5t0z4awbtShotCA+jEO2whyNF/OUQ==";

const EMAIL_RE = /^[^\s@]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,}|xn--[a-z0-9-]{2,})$/i;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;

    const name = part.slice(0, eq).trim();
    if (!name) continue;

    const value = part.slice(eq + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch (err) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || process.env.COOKIE_SECURE === "true",
    path: "/"
  };
}

function setSessionCookie(req, res, name, token, ttlMs) {
  res.cookie(name, token, {
    ...cookieOptions(req),
    maxAge: ttlMs
  });
}

function clearSessionCookie(req, res, name) {
  res.clearCookie(name, cookieOptions(req));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return !!email && email.length <= 254 && EMAIL_RE.test(email);
}

async function loadInternalSession(req, res) {
  const token = parseCookies(req.headers.cookie)[INTERNAL_COOKIE];
  if (!token) return null;

  const expiresAt = new Date(Date.now() + INTERNAL_TTL_MS);
  const { rows } = await pool.query(
    `WITH refreshed AS (
       UPDATE internal_sessions
          SET expires_at = $2
        WHERE token_hash = $1
          AND expires_at > now()
        RETURNING token_hash, username, created_at, expires_at
     )
     SELECT r.token_hash, r.username, u.role, r.created_at, r.expires_at
       FROM refreshed r
       JOIN internal_users u ON u.username = r.username`,
    [hashToken(token), expiresAt]
  );

  const session = rows[0] || null;
  if (session) setSessionCookie(req, res, INTERNAL_COOKIE, token, INTERNAL_TTL_MS);
  return session;
}

async function loadPublicSession(req, res) {
  const token = parseCookies(req.headers.cookie)[PUBLIC_COOKIE];
  if (!token) return null;

  const expiresAt = new Date(Date.now() + PUBLIC_TTL_MS);
  const { rows } = await pool.query(
    `UPDATE public_sessions
        SET expires_at = $2
      WHERE token_hash = $1
        AND expires_at > now()
      RETURNING token_hash, email, created_at, expires_at`,
    [hashToken(token), expiresAt]
  );

  const session = rows[0] || null;
  if (session) setSessionCookie(req, res, PUBLIC_COOKIE, token, PUBLIC_TTL_MS);
  return session;
}

function serializeInternalSession(session) {
  return {
    user: {
      username: session.username,
      role: session.role
    },
    sessionId: session.token_hash.slice(0, 16),
    createdAt: session.created_at,
    expiresAt: session.expires_at
  };
}

function serializePublicSession(session) {
  return {
    user: {
      email: session.email
    },
    sessionId: session.token_hash.slice(0, 16),
    createdAt: session.created_at,
    expiresAt: session.expires_at
  };
}

function cleanupExpiredSessions() {
  pool
    .query("DELETE FROM internal_sessions WHERE expires_at < now()")
    .catch((err) => console.error("internal session cleanup failed", err));
  pool
    .query("DELETE FROM public_sessions WHERE expires_at < now()")
    .catch((err) => console.error("public session cleanup failed", err));
}

async function requireInternalSession(req, res, next) {
  res.set("Cache-Control", "no-store");
  try {
    const session = await loadInternalSession(req, res);
    if (!session) return res.status(401).json({ error: "unauthorized" });
    req.internalSession = session;
    return next();
  } catch (err) {
    console.error("internal session lookup failed", err);
    return res.status(500).json({ error: "server_error" });
  }
}

async function requirePublicSession(req, res, next) {
  res.set("Cache-Control", "no-store");
  try {
    const session = await loadPublicSession(req, res);
    if (!session) return res.status(401).json({ error: "unauthorized" });
    req.publicSession = session;
    return next();
  } catch (err) {
    console.error("public session lookup failed", err);
    return res.status(500).json({ error: "server_error" });
  }
}

async function createPublicSession(req, res, email) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PUBLIC_TTL_MS);

  await pool.query(
    "INSERT INTO public_sessions (token_hash, email, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), email, expiresAt]
  );

  setSessionCookie(req, res, PUBLIC_COOKIE, token, PUBLIC_TTL_MS);
  return expiresAt;
}

app.post("/api/signup", async (req, res) => {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  const fields = isObj(body.fields) ? body.fields : {};
  const meta = isObj(body.meta) ? body.meta : {};

  try {
    await pool.query(
      "INSERT INTO signups (email, fields, meta) VALUES ($1, $2, $3)",
      [email, fields, meta]
    );
    return res.status(201).json({ ok: true, has_account: false });
  } catch (err) {
    if (err.code === "23505") {
      try {
        const { rows } = await pool.query(
          "SELECT EXISTS (SELECT 1 FROM public_users WHERE email = $1) AS has_account",
          [email]
        );
        return res.status(409).json({
          error: "duplicate",
          has_account: !!rows[0].has_account
        });
      } catch (lookupErr) {
        console.error("signup account lookup failed", lookupErr);
        return res.status(409).json({ error: "duplicate", has_account: false });
      }
    }
    console.error(err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  res.set("Cache-Control", "no-store");

  const body = req.body || {};
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password || username.length > 64 || password.length > 200) {
    return res.status(400).json({ error: "invalid_credentials" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT username, password_hash, role FROM internal_users WHERE username = $1",
      [username]
    );
    const user = rows[0];
    const valid = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !valid) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INTERNAL_TTL_MS);

    await pool.query(
      "INSERT INTO internal_sessions (token_hash, username, expires_at) VALUES ($1, $2, $3)",
      [hashToken(token), user.username, expiresAt]
    );
    cleanupExpiredSessions();

    setSessionCookie(req, res, INTERNAL_COOKIE, token, INTERNAL_TTL_MS);

    return res.json({
      ok: true,
      user: { username: user.username, role: user.role },
      expiresAt
    });
  } catch (err) {
    console.error("login failed", err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/auth/session", requireInternalSession, (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(serializeInternalSession(req.internalSession));
});

app.post("/api/auth/touch", requireInternalSession, (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(serializeInternalSession(req.internalSession));
});

// Used by Caddy's forward_auth directive to gate the static internal pages.
app.get("/api/auth/verify", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const session = await loadInternalSession(req, res);
    if (!session) return res.redirect(302, "/login.html");
    return res.status(204).end();
  } catch (err) {
    console.error("internal session verify failed", err);
    return res.status(503).end();
  }
});

app.post("/api/auth/logout", async (req, res) => {
  res.set("Cache-Control", "no-store");

  const token = parseCookies(req.headers.cookie)[INTERNAL_COOKIE];
  if (token) {
    try {
      await pool.query("DELETE FROM internal_sessions WHERE token_hash = $1", [
        hashToken(token)
      ]);
    } catch (err) {
      console.error("internal logout failed", err);
    }
  }

  clearSessionCookie(req, res, INTERNAL_COOKIE);
  return res.json({ ok: true });
});

app.post("/api/account/access", async (req, res) => {
  res.set("Cache-Control", "no-store");

  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!isValidEmail(email) || !password || password.length > 200) {
    return res.status(400).json({ error: "invalid_credentials" });
  }

  try {
    const signup = await pool.query("SELECT 1 FROM signups WHERE email = $1", [email]);
    if (!signup.rows[0]) {
      return res.status(404).json({ error: "signup_required" });
    }

    const existing = await pool.query(
      "SELECT email, password_hash FROM public_users WHERE email = $1",
      [email]
    );

    let user = existing.rows[0];
    let created = false;

    if (user) {
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: "invalid_credentials" });
    } else {
      const passwordHash = await hashPassword(password);
      try {
        const inserted = await pool.query(
          `INSERT INTO public_users (email, password_hash)
           VALUES ($1, $2)
           RETURNING email, password_hash`,
          [email, passwordHash]
        );
        user = inserted.rows[0];
        created = true;
      } catch (err) {
        if (err.code !== "23505") throw err;

        // Another request created the account between our SELECT and INSERT.
        const raced = await pool.query(
          "SELECT email, password_hash FROM public_users WHERE email = $1",
          [email]
        );
        user = raced.rows[0];
        if (!user) throw err;

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: "invalid_credentials" });
      }
    }

    const expiresAt = await createPublicSession(req, res, user.email);
    cleanupExpiredSessions();

    return res.json({
      ok: true,
      created,
      user: { email: user.email },
      expiresAt
    });
  } catch (err) {
    console.error("public account access failed", err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/account/session", requirePublicSession, (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(serializePublicSession(req.publicSession));
});

app.post("/api/account/touch", requirePublicSession, (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json(serializePublicSession(req.publicSession));
});

// Used by Caddy's forward_auth directive to gate the public account page.
app.get("/api/account/verify", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const session = await loadPublicSession(req, res);
    if (!session) return res.redirect(302, "/index.html#cta");
    return res.status(204).end();
  } catch (err) {
    console.error("public session verify failed", err);
    return res.status(503).end();
  }
});

app.post("/api/account/logout", async (req, res) => {
  res.set("Cache-Control", "no-store");

  const token = parseCookies(req.headers.cookie)[PUBLIC_COOKIE];
  if (token) {
    try {
      await pool.query("DELETE FROM public_sessions WHERE token_hash = $1", [
        hashToken(token)
      ]);
    } catch (err) {
      console.error("public logout failed", err);
    }
  }

  clearSessionCookie(req, res, PUBLIC_COOKIE);
  return res.json({ ok: true });
});

app.get("/api/internal/signups", requireInternalSession, async (req, res) => {
  res.set("Cache-Control", "no-store");

  const limit = 1000;

  try {
    const [columnsResult, rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT column_name AS name, data_type AS type
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'signups'
          ORDER BY ordinal_position`
      ),
      pool.query("SELECT * FROM signups ORDER BY created_at DESC LIMIT $1", [limit]),
      pool.query("SELECT count(*)::int AS total FROM signups")
    ]);

    const rows = rowsResult.rows;
    let columns = columnsResult.rows.map((row) => ({
      name: row.name,
      type: row.type
    }));

    if (!columns.length && rows.length) {
      columns = Object.keys(rows[0]).map((name) => ({ name, type: "" }));
    }

    return res.json({
      columns,
      rows,
      total: countResult.rows[0].total,
      limit
    });
  } catch (err) {
    console.error("signups query failed", err);
    return res.status(500).json({ error: "server_error" });
  }
});

cleanupExpiredSessions();
setInterval(cleanupExpiredSessions, 60 * 60 * 1000).unref();

app.listen(3000, "0.0.0.0");
