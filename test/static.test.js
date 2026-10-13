const fs = require("fs");
const path = require("path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const schemaSql = require("../lib/schemaSql");

const root = path.join(__dirname, "..");

test("schema file used at runtime matches db/schema.sql", () => {
  const published = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");
  const runtime = fs.readFileSync(path.join(root, "lib", "schema.sql"), "utf8");
  assert.equal(runtime, published);
  assert.equal(schemaSql, published);
  assert.match(published, /CREATE TABLE IF NOT EXISTS events/);
  assert.doesNotMatch(published, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(published, /auth\.users/);
});

test("page no longer loads Supabase and keeps the Traditional Chinese labels", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal(html.toLowerCase().includes("supabase"), false);
  assert.equal(html.includes("supabase-config.js"), false);
  for (const label of [
    "耐力賽",
    "單循環格鬥",
    "結算總分",
    "排行榜",
    "分桌表",
    "電動組",
    "手動組",
    "加入活動",
    "建立新活動",
    "Helper 密碼"
  ]) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(html.includes('const POLL_MS = 1500'));
  assert.ok(html.includes('"/api/state"'));
  assert.ok(html.includes('"/api/session"'));
  assert.ok(html.includes("ROSTER_TABLES = 12"));
});
