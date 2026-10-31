"use strict";

const { Pool } = require("pg");
const { hashPassword } = require("../password");

async function main() {
  const [usernameArg, password] = process.argv.slice(2);
  const username = (usernameArg || "").trim().toLowerCase();

  if (!username || !password) {
    console.error("Usage: node scripts/set-password.js <username> <password>");
    process.exit(1);
  }

  if (username.length > 64 || password.length > 200) {
    console.error("Username must be <= 64 chars and password <= 200 chars.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const passwordHash = await hashPassword(password);
    await pool.query(
      `INSERT INTO internal_users (username, password_hash, role)
       VALUES ($1, $2, 'Administrator')
       ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           updated_at = now()`,
      [username, passwordHash]
    );
    console.log(`Password set for ${username}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
