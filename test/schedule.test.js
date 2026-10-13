const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSchedule } = require("../lib/schedule");

function pairsOf(ids, rounds) {
  const schedule = buildSchedule(ids, rounds);
  const seenPairs = new Set();
  const byRound = new Map();
  for (const match of schedule.matches) {
    assert.notEqual(match.teamAId, match.teamBId);
    const key = [match.teamAId, match.teamBId].sort().join("|");
    assert.equal(seenPairs.has(key), false, `repeated pair ${key}`);
    seenPairs.add(key);
    const round = byRound.get(match.roundNumber) || [];
    round.push(match);
    byRound.set(match.roundNumber, round);
  }
  for (const round of byRound.values()) {
    const playing = new Set();
    for (const match of round) {
      assert.equal(playing.has(match.teamAId), false);
      assert.equal(playing.has(match.teamBId), false);
      playing.add(match.teamAId);
      playing.add(match.teamBId);
    }
  }
  return { schedule, byRound };
}

test("13 teams keep a 9-round circle with one bye each round", () => {
  const ids = Array.from({ length: 13 }, (_, index) => `t${index + 1}`);
  const { schedule, byRound } = pairsOf(ids, 9);
  assert.equal(schedule.rounds, 9);
  assert.equal(schedule.matches.length, 54);
  assert.equal(byRound.size, 9);
  const appearances = new Map(ids.map((id) => [id, 0]));
  for (const round of byRound.values()) {
    assert.equal(round.length, 6);
    const playing = new Set(round.flatMap((match) => [match.teamAId, match.teamBId]));
    assert.equal(playing.size, 12);
    for (const id of playing) appearances.set(id, appearances.get(id) + 1);
  }
  const counts = [...appearances.values()];
  assert.ok(counts.every((count) => count === 8 || count === 9));
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 108);
});

test("round count clamps to a full round robin", () => {
  const ids = Array.from({ length: 4 }, (_, index) => `t${index + 1}`);
  const schedule = buildSchedule(ids, 99);
  assert.equal(schedule.rounds, 3);
  assert.equal(schedule.matches.length, 6);
});

test("even fields have no bye", () => {
  const ids = ["a", "b"];
  const { schedule, byRound } = pairsOf(ids, 5);
  assert.equal(schedule.rounds, 1);
  assert.equal(byRound.get(0).length, 1);
});
