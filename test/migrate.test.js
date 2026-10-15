process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://fun_day:fun_day@127.0.0.1:5432/fun_day_test";

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { query, closePool } = require("../lib/db");

function freshMigrate() {
  delete require.cache[require.resolve("../lib/migrate")];
  return require("../lib/migrate");
}

describe("schema ensure", { concurrency: 1 }, () => {
before(async () => {
  await freshMigrate().ensureSchema();
});

after(async () => {
  await closePool();
});

test("ensureSchema skips DDL when the schema is already present", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE endurance_entries IN ROW EXCLUSIVE MODE");
    const started = Date.now();
    await freshMigrate().ensureSchema();
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `ensureSchema took ${elapsed}ms while endurance_entries was locked`);
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});

test("ensureSchema still creates the schema on first boot", async () => {
  await query("DROP TABLE IF EXISTS battle_matches, endurance_entries, battle_teams, events CASCADE");
  await freshMigrate().ensureSchema();
  const result = await query(
    "SELECT to_regclass('public.events') AS events, to_regclass('public.endurance_entries') AS endurance"
  );
  assert.ok(result.rows[0].events);
  assert.ok(result.rows[0].endurance);
});

test("concurrent ensureSchema calls share one in-flight migrate", async () => {
  await query("DROP TABLE IF EXISTS battle_matches, endurance_entries, battle_teams, events CASCADE");
  const { ensureSchema } = freshMigrate();
  await Promise.all([ensureSchema(), ensureSchema(), ensureSchema(), ensureSchema()]);
  const result = await query("SELECT to_regclass('public.battle_matches') AS matches");
  assert.ok(result.rows[0].matches);
});
});
