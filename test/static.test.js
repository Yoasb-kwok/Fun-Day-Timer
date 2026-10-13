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
    "輪轉表",
    "綜合總分",
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
  assert.ok(html.includes("FunDayRotation.TABLES_PER_SIDE"));
  assert.ok(html.includes("不是共用 1–12"));
  assert.ok(html.includes("此邊桌號 1–6"));
  assert.equal(html.includes("ROSTER_TABLES = 12"), false);
  assert.equal(html.includes("各 12 組"), false);
  assert.equal(html.includes("桌號 1–12"), false);
  assert.ok(html.includes('src="lib/f1Points.js"'));
  assert.ok(html.includes('src="lib/rotation.js"'));
  assert.ok(html.includes("FunDayF1.rankEndurance"));
  assert.ok(html.includes("FunDayF1.rankBattle"));
  assert.ok(html.includes("FunDayF1.combinePlacePoints"));
  assert.ok(html.includes("FunDayRotation.rotationSheet"));
  assert.ok(html.includes("<th>桌號</th><th>A組</th><th>B組</th><th>輪次</th>"));
  assert.ok(html.includes("電動第N + 手動第N"));
  assert.ok(html.includes("第1名 25、第2名 18、第3名 15、第4名 12、第5名 10、第6名 8、第7名 6、第8名 4、第9名 2、第10名 1，第11名及以後 0"));
  assert.equal(html.includes("83.45"), false);
  assert.equal(html.includes("勝場 × 3"), false);
  assert.equal(html.includes("最佳秒數"), false);
});
