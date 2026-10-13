const schemaSql = require("./schemaSql");
const { getPool } = require("./db");

let migrated = false;
let migrating = null;

async function runMigrate() {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(84261501)");
    await client.query(schemaSql);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Schema rollback failed", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSchema() {
  if (migrated) return;
  if (!migrating) {
    migrating = runMigrate()
      .then(() => {
        migrated = true;
      })
      .catch((error) => {
        migrating = null;
        throw error;
      });
  }
  return migrating;
}

module.exports = { ensureSchema, runMigrate };
