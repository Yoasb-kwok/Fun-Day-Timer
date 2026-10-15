const { Pool } = require("pg");

let pool;

function needsSsl(connectionString) {
  if (process.env.DATABASE_SSL === "disable") return false;
  return !/localhost|127\.0\.0\.1|\[::1\]/.test(connectionString);
}

function connectionStringWithoutSslMode(connectionString) {
  return connectionString
    .replace(/([?&])sslmode=[^&]*/g, "$1")
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");
}

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const error = new Error("DATABASE_URL is not set");
    error.status = 503;
    throw error;
  }
  if (!pool) {
    const ssl = needsSsl(connectionString) ? { rejectUnauthorized: false } : false;
    pool = new Pool({
      connectionString: connectionStringWithoutSslMode(connectionString),
      ssl,
      max: 15,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      options: "-c search_path=public -c statement_timeout=8000"
    });
    pool.on("error", (err) => {
      console.error("Postgres pool error", err);
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Postgres rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

module.exports = { getPool, query, withTransaction, closePool };
