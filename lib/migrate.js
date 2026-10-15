const schemaSql = require("./schemaSql");
const { getPool } = require("./db");

let migrated = false;
let migrating = null;

// Catalog-only probe. Must not lock endurance_entries / events (those take
// RowExclusiveLock on the live workshop). DROP TRIGGER needs AccessExclusiveLock
// and deadlocks with those updates, so this has to be true before any DDL.
const READY_SQL = `
SELECT (
  to_regclass('public.events') IS NOT NULL
  AND to_regclass('public.battle_teams') IS NOT NULL
  AND to_regclass('public.endurance_entries') IS NOT NULL
  AND to_regclass('public.battle_matches') IS NOT NULL
  AND to_regclass('public.endurance_entries_team_category_idx') IS NOT NULL
  AND to_regclass('public.battle_matches_event_category_round_match_idx') IS NOT NULL
  AND (
    SELECT COUNT(DISTINCT t.tgname)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND (c.relname, t.tgname) IN (
        ('events', 'events_touch_updated_at'),
        ('endurance_entries', 'endurance_touch_updated_at'),
        ('battle_teams', 'battle_teams_touch_updated_at'),
        ('battle_matches', 'battle_matches_touch_updated_at')
      )
  ) = 4
) AS ready
`;

async function schemaIsReady(client) {
  const result = await client.query(READY_SQL);
  return Boolean(result.rows[0] && result.rows[0].ready);
}

async function runMigrate() {
  const client = await getPool().connect();
  let started = false;
  try {
    if (await schemaIsReady(client)) return;

    await client.query("BEGIN");
    started = true;
    await client.query("SELECT pg_advisory_xact_lock(84261501)");
    if (!(await schemaIsReady(client))) {
      await client.query(schemaSql);
    }
    await client.query("COMMIT");
    started = false;
  } catch (error) {
    if (started) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Schema rollback failed", rollbackError);
      }
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
