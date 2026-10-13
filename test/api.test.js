process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://fun_day:fun_day@127.0.0.1:5432/fun_day_test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret";
process.env.COOKIE_SECURE = "false";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { server } = require("../server");
const { query, closePool } = require("../lib/db");
const { ensureSchema } = require("../lib/migrate");
const schemaSql = require("../lib/schemaSql");

let base;

function client() {
  let cookie = "";
  return async function request(path, { method = "GET", body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const item of setCookies) {
      const pair = item.split(";")[0];
      const eq = pair.indexOf("=");
      if (pair.slice(0, eq) === "fun_day_session") {
        const value = pair.slice(eq + 1);
        cookie = value ? `fun_day_session=${value}` : "";
      }
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data, cookie, setCookies };
  };
}

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await ensureSchema();
});

beforeEach(async () => {
  await query("TRUNCATE events CASCADE");
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await closePool();
});

function electricEntries(data) {
  return data.endurance.filter((row) => row.category === "electric");
}

function electricMatches(data, round = 0) {
  return data.matches.filter((row) => row.category === "electric" && row.roundNumber === round);
}

async function createEvent(request, code = "FUN-DAY") {
  const created = await request("/api/session", {
    method: "POST",
    body: { mode: "create", code, password: "helpers", name: "陀螺 Fun Day", school: "香港佛教劉金龍中學" }
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  return created;
}

test("health migrates twice and does not require a session", async () => {
  const request = client();
  const health = await request("/api/health");
  assert.deepEqual(health.data, { ok: true });
  await query(schemaSql);
  const state = await request("/api/state");
  assert.equal(state.status, 401);
});

test("create, join, and reject a wrong password without leaking the hash", async () => {
  const owner = client();
  const created = await createEvent(owner, "SYNC-1");
  assert.equal(created.data.teams.length, 13);
  assert.equal(electricEntries(created.data).length, 13);
  assert.equal(created.data.matches.filter((row) => row.category === "electric").length, 54);
  assert.equal(created.data.matches.filter((row) => row.category === "manual").length, 54);
  assert.equal(JSON.stringify(created.data).includes("password"), false);
  assert.equal(JSON.stringify(created.data).includes("scrypt"), false);
  assert.match(created.setCookies[0], /HttpOnly/);
  assert.match(created.setCookies[0], /SameSite=Lax/);

  const helper = client();
  const denied = await helper("/api/session", {
    method: "POST",
    body: { mode: "join", code: "SYNC-1", password: "nope" }
  });
  assert.equal(denied.status, 401);
  const missing = await helper("/api/session", {
    method: "POST",
    body: { mode: "join", code: "MISSING", password: "helpers" }
  });
  assert.equal(missing.status, 401);
  assert.equal(missing.data.error, denied.data.error);

  const joined = await helper("/api/session", {
    method: "POST",
    body: { mode: "join", code: "sync-1", password: "helpers" }
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.event.id, created.data.event.id);
  assert.equal(joined.data.teams.length, 13);
});

test("battle match timer uses the server clock and can pause", async () => {
  const request = client();
  const created = await createEvent(request, "CLOCK");
  const match = electricMatches(created.data)[0];
  const started = await request("/api/battle", { method: "POST", body: { action: "start-timer", matchId: match.id } });
  assert.equal(started.data.matches.find((row) => row.id === match.id).timerRunning, true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const paused = await request("/api/battle", { method: "POST", body: { action: "pause-timer", matchId: match.id } });
  const row = paused.data.matches.find((item) => item.id === match.id);
  assert.equal(row.timerRunning, false);
  assert.ok(row.timerElapsedMs >= 100, `elapsed ${row.timerElapsedMs}`);
});

test("duplicate event codes are rejected", async () => {
  const first = client();
  await createEvent(first, "DUP-1");
  const second = client();
  const again = await second("/api/session", {
    method: "POST",
    body: { mode: "create", code: "dup-1", password: "helpers" }
  });
  assert.equal(again.status, 409);
});

test("endurance keeps the longer attempt and ranks data independently by category", async () => {
  const request = client();
  const created = await createEvent(request, "ENDURE");
  const entry = electricEntries(created.data)[0];
  const manual = created.data.endurance.find((row) => row.category === "manual" && row.teamId === entry.teamId);

  const started = await request("/api/endurance", { method: "POST", body: { action: "start", entryId: entry.id } });
  assert.equal(started.status, 200);
  const running = electricEntries(started.data).find((row) => row.id === entry.id);
  assert.equal(running.status, "running");
  const again = await request("/api/state");
  await new Promise((resolve) => setTimeout(resolve, 220));
  const later = await request("/api/state");
  assert.equal(again.data.version, later.data.version);

  const finished = await request("/api/endurance", { method: "POST", body: { action: "finish", entryId: entry.id } });
  const first = electricEntries(finished.data).find((row) => row.id === entry.id);
  assert.equal(first.status, "done");
  assert.ok(first.bestElapsedMs >= 200, `best was ${first.bestElapsedMs}`);

  await request("/api/endurance", { method: "POST", body: { action: "start", entryId: entry.id } });
  const shorter = await request("/api/endurance", { method: "POST", body: { action: "finish", entryId: entry.id } });
  const second = electricEntries(shorter.data).find((row) => row.id === entry.id);
  assert.equal(second.bestElapsedMs, first.bestElapsedMs);

  const reset = await request("/api/endurance", { method: "POST", body: { action: "reset", entryId: entry.id } });
  const resetRow = electricEntries(reset.data).find((row) => row.id === entry.id);
  assert.equal(resetRow.elapsedMs, 0);
  assert.equal(resetRow.bestElapsedMs, first.bestElapsedMs);

  const manualRow = reset.data.endurance.find((row) => row.id === manual.id);
  assert.equal(manualRow.bestElapsedMs, 0);

  const cleared = await request("/api/endurance", { method: "POST", body: { action: "clear-best", entryId: entry.id } });
  assert.equal(electricEntries(cleared.data).find((row) => row.id === entry.id).bestElapsedMs, 0);

  await request("/api/endurance", { method: "POST", body: { action: "start", entryId: entry.id } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await request("/api/endurance", { method: "POST", body: { action: "finish", entryId: entry.id } });
  const categoryReset = await request("/api/endurance", {
    method: "POST",
    body: { action: "reset-category", category: "manual" }
  });
  assert.ok(electricEntries(categoryReset.data).find((row) => row.id === entry.id).bestElapsedMs > 0);
});

test("battle scores, tally, and round changes stay inside one category", async () => {
  const owner = client();
  const created = await createEvent(owner, "BATTLE");
  const match = electricMatches(created.data)[0];
  const helper = client();
  await helper("/api/session", { method: "POST", body: { mode: "join", code: "BATTLE", password: "helpers" } });

  const scored = await owner("/api/battle", {
    method: "POST",
    body: { action: "score", matchId: match.id, aScore: 2, bScore: 1, updatedAtToken: match.updatedAtToken }
  });
  assert.equal(scored.status, 200, JSON.stringify(scored.data));
  const saved = scored.data.matches.find((row) => row.id === match.id);
  assert.equal(saved.complete, true);
  assert.equal(saved.aScore, 2);
  assert.equal(saved.bScore, 1);

  const stale = await owner("/api/battle", {
    method: "POST",
    body: { action: "score", matchId: match.id, aScore: 2, bScore: 0, updatedAtToken: match.updatedAtToken }
  });
  assert.equal(stale.status, 409);

  const helperView = await helper("/api/state");
  assert.equal(helperView.data.matches.find((row) => row.id === match.id).complete, true);

  const tally = await owner("/api/battle", { method: "POST", body: { action: "tally" } });
  assert.ok(tally.data.event.battleTalliedAt);
  const helperTally = await helper("/api/state");
  assert.equal(helperTally.data.event.battleTalliedAt, tally.data.event.battleTalliedAt);

  const blocked = await owner("/api/battle", { method: "POST", body: { action: "rounds", category: "electric", rounds: 8 } });
  assert.equal(blocked.status, 409);
  const manualRounds = await owner("/api/battle", { method: "POST", body: { action: "rounds", category: "manual", rounds: 8 } });
  assert.equal(manualRounds.status, 200, JSON.stringify(manualRounds.data));
  assert.equal(manualRounds.data.event.manualRoundCount, 8);
  assert.equal(manualRounds.data.event.electricRoundCount, 9);
  assert.equal(manualRounds.data.matches.filter((row) => row.category === "manual").length, 48);

  const otherEvent = client();
  await createEvent(otherEvent, "OTHER");
  const foreign = await otherEvent("/api/battle", {
    method: "POST",
    body: { action: "score", matchId: match.id, aScore: 1, bScore: 0, updatedAtToken: saved.updatedAtToken }
  });
  assert.equal(foreign.status, 404);
});

test("team changes rebuild a clean schedule and settings rename both boards", async () => {
  const request = client();
  const created = await createEvent(request, "TEAMS");
  const match = electricMatches(created.data)[0];
  await request("/api/battle", {
    method: "POST",
    body: { action: "score", matchId: match.id, aScore: 1, bScore: 0, updatedAtToken: match.updatedAtToken }
  });
  const blocked = await request("/api/teams", { method: "POST", body: { action: "add" } });
  assert.equal(blocked.status, 409);

  await request("/api/battle", { method: "POST", body: { action: "reset-category", category: "electric" } });
  const added = await request("/api/teams", { method: "POST", body: { action: "add", name: "後備組" } });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.equal(added.data.teams.length, 14);
  assert.equal(added.data.endurance.length, 28);
  assert.equal(added.data.teams[13].name, "後備組");

  const renamed = await request("/api/settings", {
    method: "POST",
    body: {
      name: "決賽日",
      school: "測試中學",
      teams: [{ id: added.data.teams[0].id, name: "甲組" }]
    }
  });
  assert.equal(renamed.data.event.name, "決賽日");
  assert.equal(renamed.data.event.schoolName, "測試中學");
  assert.equal(renamed.data.teams[0].name, "甲組");

  const removed = await request("/api/teams", {
    method: "POST",
    body: { action: "delete", teamId: added.data.teams[13].id }
  });
  assert.equal(removed.data.teams.length, 13);

  const reset = await request("/api/reset", { method: "POST", body: {} });
  assert.equal(reset.data.teams[0].name, "第 1 組");
  assert.equal(reset.data.event.battleTalliedAt, null);
  assert.ok(reset.data.endurance.every((row) => row.bestElapsedMs === 0 && row.status === "idle"));
  assert.ok(reset.data.matches.every((row) => row.aScore === 0 && row.complete === false));

  const loggedOut = await request("/api/logout", { method: "POST", body: {} });
  assert.equal(loggedOut.status, 200);
  const afterLogout = await request("/api/state");
  assert.equal(afterLogout.status, 401);
});
