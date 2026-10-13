const { createHash } = require("crypto");
const { query, withTransaction } = require("./db");
const { hashPassword, verifyPassword } = require("./auth");
const { buildSchedule } = require("./schedule");
const { HttpError } = require("./httpError");

const DEFAULT_TEAMS = 13;
const MATCH_LIMIT_MS = 120000;
const TOKEN_SQL = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`;

let dummyHashPromise = null;

function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("not-a-real-helper-password");
  return dummyHashPromise;
}

function cleanCode(code) {
  return String(code || "").trim().toUpperCase();
}

function assertEventCode(code) {
  const normalized = cleanCode(code);
  if (!/^[A-Z0-9-]{3,20}$/.test(normalized)) {
    throw new HttpError(400, "活動代碼須為 3–20 個英文字母、數字或連字號");
  }
  return normalized;
}

function assertPassword(password) {
  const value = String(password ?? "");
  if (value.length < 4 || value.length > 200) {
    throw new HttpError(400, "Helper 密碼須為 4–200 個字元");
  }
  return value;
}

function assertCategory(category) {
  if (category !== "electric" && category !== "manual") {
    throw new HttpError(400, "無效的格鬥賽類別");
  }
  return category;
}

function cleanText(value, fallback, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return text || fallback;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function runner(db) {
  return db && typeof db.query === "function" ? db : { query };
}

async function loadSnapshot(eventId, db) {
  const run = runner(db);
  const eventResult = await run.query(
    `SELECT id, code, name, school_name,
            active_round, round_count,
            electric_round_count, manual_round_count,
            electric_active_round, manual_active_round,
            battle_tallied_at, updated_at
     FROM events
     WHERE id = $1`,
    [eventId]
  );
  if (!eventResult.rowCount) throw new HttpError(404, "找不到此活動");
  const eventRow = eventResult.rows[0];
  // One client cannot run these at the same time, and the pool size is 1.
  const teamsResult = await run.query(
    `SELECT id, team_number, name, updated_at
     FROM battle_teams
     WHERE event_id = $1
     ORDER BY team_number`,
    [eventId]
  );
  const enduranceResult = await run.query(
    `SELECT id, battle_team_id, category, name, position,
            elapsed_ms, best_elapsed_ms, started_at, status, updated_at
     FROM endurance_entries
     WHERE event_id = $1 AND archived = false
     ORDER BY category, position, id`,
    [eventId]
  );
  const matchesResult = await run.query(
    `SELECT id, category, round_number, match_number, team_a_id, team_b_id,
            a_score, b_score, complete, timer_elapsed_ms, timer_started_at, timer_running,
            ${TOKEN_SQL} AS updated_at_token, updated_at
     FROM battle_matches
     WHERE event_id = $1
     ORDER BY category, round_number, match_number`,
    [eventId]
  );

  const snapshot = {
    event: {
      id: eventRow.id,
      code: eventRow.code,
      name: eventRow.name,
      schoolName: eventRow.school_name,
      activeRound: num(eventRow.active_round),
      roundCount: num(eventRow.round_count),
      electricRoundCount: num(eventRow.electric_round_count),
      manualRoundCount: num(eventRow.manual_round_count),
      electricActiveRound: num(eventRow.electric_active_round),
      manualActiveRound: num(eventRow.manual_active_round),
      battleTalliedAt: iso(eventRow.battle_tallied_at),
      updatedAt: iso(eventRow.updated_at)
    },
    teams: teamsResult.rows.map((row) => ({
      id: row.id,
      teamNumber: num(row.team_number),
      name: row.name,
      updatedAt: iso(row.updated_at)
    })),
    endurance: enduranceResult.rows.map((row) => ({
      id: row.id,
      teamId: row.battle_team_id,
      category: row.category,
      name: row.name,
      position: num(row.position),
      elapsedMs: num(row.elapsed_ms),
      bestElapsedMs: num(row.best_elapsed_ms),
      startedAt: iso(row.started_at),
      status: row.status,
      updatedAt: iso(row.updated_at)
    })),
    matches: matchesResult.rows.map((row) => ({
      id: row.id,
      category: row.category,
      roundNumber: num(row.round_number),
      matchNumber: num(row.match_number),
      teamAId: row.team_a_id,
      teamBId: row.team_b_id,
      aScore: num(row.a_score),
      bScore: num(row.b_score),
      complete: Boolean(row.complete),
      timerElapsedMs: num(row.timer_elapsed_ms),
      timerStartedAt: iso(row.timer_started_at),
      timerRunning: Boolean(row.timer_running),
      updatedAtToken: row.updated_at_token,
      updatedAt: iso(row.updated_at)
    }))
  };
  snapshot.version = createHash("sha1").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16);
  return snapshot;
}

async function withEvent(eventId, fn) {
  return withTransaction(async (client) => {
    const locked = await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
    if (!locked.rowCount) throw new HttpError(404, "找不到此活動");
    await fn(client);
    return loadSnapshot(eventId, client);
  });
}

async function teamIds(client, eventId) {
  const result = await client.query(
    "SELECT id FROM battle_teams WHERE event_id = $1 ORDER BY team_number",
    [eventId]
  );
  return result.rows.map((row) => row.id);
}

async function regenerate(client, eventId, requestedRounds, category) {
  const categories = category ? [assertCategory(category)] : ["electric", "manual"];
  const dirty = await client.query(
    `SELECT 1
     FROM battle_matches
     WHERE event_id = $1
       AND category = ANY($2::text[])
       AND (complete OR a_score > 0 OR b_score > 0 OR timer_elapsed_ms > 0 OR timer_running)
     LIMIT 1`,
    [eventId, categories]
  );
  if (dirty.rowCount) {
    throw new HttpError(409, "已有格鬥賽紀錄，請先重設該場格鬥賽才可重排賽程");
  }

  const ids = await teamIds(client, eventId);
  if (ids.length < 2) throw new HttpError(400, "格鬥賽最少需要 2 組");
  const event = await client.query(
    "SELECT electric_round_count, manual_round_count FROM events WHERE id = $1",
    [eventId]
  );
  const counts = event.rows[0];

  for (const current of categories) {
    const requested = requestedRounds == null
      ? Number(current === "electric" ? counts.electric_round_count : counts.manual_round_count) || 9
      : Number(requestedRounds);
    const schedule = buildSchedule(ids, requested);
    await client.query("DELETE FROM battle_matches WHERE event_id = $1 AND category = $2", [eventId, current]);
    if (schedule.matches.length) {
      const values = [];
      const params = [];
      schedule.matches.forEach((match, index) => {
        const base = index * 6;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
        params.push(eventId, current, match.roundNumber, match.matchNumber, match.teamAId, match.teamBId);
      });
      await client.query(
        `INSERT INTO battle_matches
           (event_id, category, round_number, match_number, team_a_id, team_b_id)
         VALUES ${values.join(",")}`,
        params
      );
    }
    if (current === "electric") {
      await client.query(
        `UPDATE events
         SET electric_round_count = $2,
             electric_active_round = LEAST(electric_active_round, $2 - 1),
             round_count = $2,
             active_round = LEAST(active_round, $2 - 1)
         WHERE id = $1`,
        [eventId, schedule.rounds]
      );
    } else {
      await client.query(
        `UPDATE events
         SET manual_round_count = $2,
             manual_active_round = LEAST(manual_active_round, $2 - 1)
         WHERE id = $1`,
        [eventId, schedule.rounds]
      );
    }
  }
}

async function insertTeam(client, eventId, teamNumber, name) {
  const team = await client.query(
    `INSERT INTO battle_teams (event_id, team_number, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [eventId, teamNumber, name]
  );
  const teamId = team.rows[0].id;
  await client.query(
    `INSERT INTO endurance_entries
       (event_id, battle_team_id, category, name, position)
     VALUES
       ($1, $2, 'electric', $3, $4),
       ($1, $2, 'manual', $3, $4)`,
    [eventId, teamId, name, teamNumber - 1]
  );
  return teamId;
}

async function createEvent(body) {
  const code = assertEventCode(body.code);
  const password = assertPassword(body.password);
  const name = cleanText(body.name, "陀螺 Fun Day", 80);
  const school = cleanText(body.school, "香港佛教劉金龍中學", 80);
  const passwordHash = await hashPassword(password);

  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO events (code, name, school_name, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [code, name, school, passwordHash]
      );
      const eventId = inserted.rows[0].id;
      for (let number = 1; number <= DEFAULT_TEAMS; number += 1) {
        await insertTeam(client, eventId, number, `第 ${number} 組`);
      }
      await regenerate(client, eventId, 9, null);
      return eventId;
    });
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "此活動代碼已有人使用");
    throw error;
  }
}

async function joinEvent(code, password) {
  const normalized = cleanCode(code);
  const secret = String(password ?? "");
  if (secret.length > 200) throw new HttpError(400, "Helper 密碼須為 4–200 個字元");
  const found = await query("SELECT id, password_hash FROM events WHERE code = $1", [normalized]);
  const row = found.rows[0];
  const hash = row ? row.password_hash : await dummyHash();
  const ok = secret.length >= 4 && await verifyPassword(secret, hash);
  if (!row || !ok) throw new HttpError(401, "活動代碼或 Helper 密碼不正確");
  return row.id;
}

async function enduranceAction(eventId, body) {
  const action = body.action;
  return withEvent(eventId, async (client) => {
    if (action === "reset-category") {
      const category = assertCategory(body.category);
      await client.query(
        `UPDATE endurance_entries
         SET elapsed_ms = 0, best_elapsed_ms = 0, started_at = NULL, status = 'idle'
         WHERE event_id = $1 AND category = $2 AND archived = false`,
        [eventId, category]
      );
      return;
    }

    const entryId = body.entryId;
    if (!entryId) throw new HttpError(400, "找不到此組的計時紀錄");
    if (action === "start") {
      const updated = await client.query(
        `UPDATE endurance_entries
         SET started_at = clock_timestamp(), status = 'running', elapsed_ms = 0
         WHERE id = $1 AND event_id = $2 AND status <> 'running'`,
        [entryId, eventId]
      );
      if (updated.rowCount) return;
      const existing = await client.query(
        "SELECT status FROM endurance_entries WHERE id = $1 AND event_id = $2",
        [entryId, eventId]
      );
      if (existing.rows[0]?.status === "running") return;
      throw new HttpError(404, "找不到此組的計時紀錄");
    }
    if (action === "finish") {
      const updated = await client.query(
        `UPDATE endurance_entries
         SET elapsed_ms = elapsed_ms + COALESCE(
               (GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - started_at)) * 1000)))::bigint,
               0
             ),
             started_at = NULL,
             status = 'done'
         WHERE id = $1 AND event_id = $2 AND status = 'running'
         RETURNING elapsed_ms`,
        [entryId, eventId]
      );
      if (!updated.rowCount) throw new HttpError(409, "計時尚未開始");
      const attempt = num(updated.rows[0].elapsed_ms);
      await client.query(
        `UPDATE endurance_entries
         SET best_elapsed_ms = $3
         WHERE id = $1 AND event_id = $2 AND $3 > best_elapsed_ms`,
        [entryId, eventId, attempt]
      );
      return;
    }
    if (action === "reset") {
      const updated = await client.query(
        `UPDATE endurance_entries
         SET elapsed_ms = 0, started_at = NULL, status = 'idle'
         WHERE id = $1 AND event_id = $2`,
        [entryId, eventId]
      );
      if (!updated.rowCount) throw new HttpError(404, "找不到此組的計時紀錄");
      return;
    }
    if (action === "clear-best") {
      const updated = await client.query(
        `UPDATE endurance_entries
         SET elapsed_ms = 0, best_elapsed_ms = 0, started_at = NULL, status = 'idle'
         WHERE id = $1 AND event_id = $2`,
        [entryId, eventId]
      );
      if (!updated.rowCount) throw new HttpError(404, "找不到此組的計時紀錄");
      return;
    }
    throw new HttpError(400, "不支援的計時操作");
  });
}

async function battleHasProgress(client, eventId, category) {
  const params = [eventId];
  let categorySql = "";
  if (category) {
    params.push(category);
    categorySql = "AND category = $2";
  }
  const dirty = await client.query(
    `SELECT 1 FROM battle_matches
     WHERE event_id = $1 ${categorySql}
       AND (complete OR a_score > 0 OR b_score > 0 OR timer_elapsed_ms > 0 OR timer_running)
     LIMIT 1`,
    params
  );
  return Boolean(dirty.rowCount);
}

async function battleAction(eventId, body) {
  const action = body.action;
  return withEvent(eventId, async (client) => {
    if (action === "tally") {
      await client.query("UPDATE events SET battle_tallied_at = clock_timestamp() WHERE id = $1", [eventId]);
      return;
    }
    if (action === "rounds") {
      const category = assertCategory(body.category);
      const rounds = Number(body.rounds);
      if (!Number.isInteger(rounds)) throw new HttpError(400, "輪次不正確");
      await regenerate(client, eventId, rounds, category);
      return;
    }
    if (action === "active-round") {
      const category = assertCategory(body.category);
      const round = Number(body.round);
      if (!Number.isInteger(round) || round < 0) throw new HttpError(400, "輪次超出範圍");
      const column = category === "electric" ? "electric_round_count" : "manual_round_count";
      const event = await client.query(`SELECT ${column} AS rounds FROM events WHERE id = $1`, [eventId]);
      const rounds = num(event.rows[0].rounds);
      if (round >= rounds) throw new HttpError(400, "輪次超出範圍");
      if (category === "electric") {
        await client.query(
          "UPDATE events SET electric_active_round = $2, active_round = $2 WHERE id = $1",
          [eventId, round]
        );
      } else {
        await client.query("UPDATE events SET manual_active_round = $2 WHERE id = $1", [eventId, round]);
      }
      return;
    }
    if (action === "reset-category") {
      const category = assertCategory(body.category);
      await client.query(
        `UPDATE battle_matches
         SET a_score = 0, b_score = 0, complete = false,
             timer_elapsed_ms = 0, timer_started_at = NULL, timer_running = false
         WHERE event_id = $1 AND category = $2`,
        [eventId, category]
      );
      if (category === "electric") {
        await client.query(
          "UPDATE events SET electric_active_round = 0, active_round = 0 WHERE id = $1",
          [eventId]
        );
      } else {
        await client.query("UPDATE events SET manual_active_round = 0 WHERE id = $1", [eventId]);
      }
      return;
    }

    const matchId = body.matchId;
    if (!matchId) throw new HttpError(400, "找不到此場賽事");
    if (action === "score") {
      const a = Number(body.aScore);
      const b = Number(body.bScore);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 2 || b < 0 || b > 2) {
        throw new HttpError(400, "盤數必須是 0–2");
      }
      if ((a === 2 && b > 1) || (b === 2 && a > 1)) {
        throw new HttpError(400, "三盤兩勝的賽果不正確");
      }
      const token = body.updatedAtToken;
      if (!token || typeof token !== "string") throw new HttpError(400, "缺少賽事版本，請重新整理");
      const complete = a === 2 || b === 2;
      const updated = await client.query(
        `UPDATE battle_matches
         SET a_score = $3,
             b_score = $4,
             complete = $5,
             timer_elapsed_ms = CASE
               WHEN $5 AND timer_running THEN LEAST(
                 $7,
                 timer_elapsed_ms + COALESCE(
                   (GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - timer_started_at)) * 1000)))::bigint,
                   0
                 )
               )
               ELSE timer_elapsed_ms
             END,
             timer_started_at = CASE WHEN $5 AND timer_running THEN NULL ELSE timer_started_at END,
             timer_running = CASE WHEN $5 AND timer_running THEN false ELSE timer_running END
         WHERE id = $1
           AND event_id = $2
           AND ${TOKEN_SQL} = $6`,
        [matchId, eventId, a, b, complete, token, MATCH_LIMIT_MS]
      );
      if (updated.rowCount) return;
      const existing = await client.query(
        "SELECT id FROM battle_matches WHERE id = $1 AND event_id = $2",
        [matchId, eventId]
      );
      if (!existing.rowCount) throw new HttpError(404, "找不到此場賽事");
      throw new HttpError(409, "另一位 Helper 剛剛更新了此場，已載入最新賽果");
    }
    if (action === "start-timer") {
      const updated = await client.query(
        `UPDATE battle_matches
         SET timer_started_at = clock_timestamp(), timer_running = true
         WHERE id = $1 AND event_id = $2 AND NOT timer_running`,
        [matchId, eventId]
      );
      if (updated.rowCount) return;
      const existing = await client.query(
        "SELECT timer_running FROM battle_matches WHERE id = $1 AND event_id = $2",
        [matchId, eventId]
      );
      if (existing.rows[0]?.timer_running) return;
      throw new HttpError(404, "找不到此場賽事");
    }
    if (action === "pause-timer") {
      const updated = await client.query(
        `UPDATE battle_matches
         SET timer_elapsed_ms = LEAST(
               $3,
               timer_elapsed_ms + COALESCE(
                 (GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - timer_started_at)) * 1000)))::bigint,
                 0
               )
             ),
             timer_started_at = NULL,
             timer_running = false
         WHERE id = $1 AND event_id = $2 AND timer_running`,
        [matchId, eventId, MATCH_LIMIT_MS]
      );
      if (updated.rowCount) return;
      const existing = await client.query(
        "SELECT id FROM battle_matches WHERE id = $1 AND event_id = $2",
        [matchId, eventId]
      );
      if (!existing.rowCount) throw new HttpError(404, "找不到此場賽事");
      return;
    }
    if (action === "reset-match") {
      const updated = await client.query(
        `UPDATE battle_matches
         SET a_score = 0, b_score = 0, complete = false,
             timer_elapsed_ms = 0, timer_started_at = NULL, timer_running = false
         WHERE id = $1 AND event_id = $2`,
        [matchId, eventId]
      );
      if (!updated.rowCount) throw new HttpError(404, "找不到此場賽事");
      return;
    }
    throw new HttpError(400, "不支援的格鬥操作");
  });
}

async function teamAction(eventId, body) {
  return withEvent(eventId, async (client) => {
    if (body.action === "add") {
      const next = await client.query(
        "SELECT COALESCE(MAX(team_number), 0) + 1 AS n FROM battle_teams WHERE event_id = $1",
        [eventId]
      );
      const number = num(next.rows[0].n);
      const name = cleanText(body.name, `第 ${number} 組`, 30);
      await insertTeam(client, eventId, number, name);
      await regenerate(client, eventId, null, null);
      return;
    }
    if (body.action === "delete") {
      const team = await client.query(
        "SELECT id FROM battle_teams WHERE id = $1 AND event_id = $2",
        [body.teamId, eventId]
      );
      if (!team.rowCount) throw new HttpError(404, "找不到此組別");
      if (await battleHasProgress(client, eventId)) {
        throw new HttpError(409, "已有格鬥賽紀錄，請先重設格鬥賽才可刪除組別");
      }
      const count = await client.query(
        "SELECT count(*)::int AS n FROM battle_teams WHERE event_id = $1",
        [eventId]
      );
      if (num(count.rows[0].n) <= 2) throw new HttpError(400, "格鬥賽最少需要 2 組");
      await client.query("DELETE FROM battle_teams WHERE id = $1 AND event_id = $2", [body.teamId, eventId]);
      await regenerate(client, eventId, null, null);
      return;
    }
    throw new HttpError(400, "不支援的組別操作");
  });
}

async function saveSettings(eventId, body) {
  const name = cleanText(body.name, "陀螺 Fun Day", 80);
  const school = cleanText(body.school, "香港佛教劉金龍中學", 80);
  const teams = Array.isArray(body.teams) ? body.teams : [];
  return withEvent(eventId, async (client) => {
    await client.query("UPDATE events SET name = $2, school_name = $3 WHERE id = $1", [eventId, name, school]);
    for (const team of teams) {
      if (!team || !team.id) continue;
      const existing = await client.query(
        "SELECT team_number FROM battle_teams WHERE id = $1 AND event_id = $2",
        [team.id, eventId]
      );
      if (!existing.rowCount) throw new HttpError(400, "找不到要更新的組別");
      const teamName = cleanText(team.name, `第 ${existing.rows[0].team_number} 組`, 30);
      await client.query("UPDATE battle_teams SET name = $2 WHERE id = $1", [team.id, teamName]);
      await client.query(
        "UPDATE endurance_entries SET name = $3 WHERE battle_team_id = $1 AND event_id = $2",
        [team.id, eventId, teamName]
      );
    }
  });
}

async function resetAll(eventId) {
  return withEvent(eventId, async (client) => {
    const teams = await client.query(
      "SELECT id FROM battle_teams WHERE event_id = $1 ORDER BY team_number",
      [eventId]
    );
    for (let index = 0; index < teams.rows.length; index += 1) {
      const name = `第 ${index + 1} 組`;
      const teamId = teams.rows[index].id;
      await client.query("UPDATE battle_teams SET name = $2 WHERE id = $1", [teamId, name]);
      await client.query(
        `UPDATE endurance_entries
         SET name = $2, elapsed_ms = 0, best_elapsed_ms = 0, started_at = NULL, status = 'idle'
         WHERE battle_team_id = $1 AND event_id = $3`,
        [teamId, name, eventId]
      );
    }
    await client.query(
      `UPDATE battle_matches
       SET a_score = 0, b_score = 0, complete = false,
           timer_elapsed_ms = 0, timer_started_at = NULL, timer_running = false
       WHERE event_id = $1`,
      [eventId]
    );
    await client.query(
      `UPDATE events
       SET active_round = 0,
           electric_active_round = 0,
           manual_active_round = 0,
           battle_tallied_at = NULL
       WHERE id = $1`,
      [eventId]
    );
  });
}

module.exports = {
  loadSnapshot,
  createEvent,
  joinEvent,
  enduranceAction,
  battleAction,
  teamAction,
  saveSettings,
  resetAll
};
