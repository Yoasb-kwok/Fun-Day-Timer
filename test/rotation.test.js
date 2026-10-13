const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rotationSheet } = require("../lib/rotation");

test("rotation rows are table, the two teams, and the round", () => {
  const sheet = rotationSheet([
    { matches: [{ a: 0, b: 1, n: 0 }, { a: 2, b: 3, n: 1 }], bye: 4 },
    { matches: [{ a: 1, b: 2, n: 0 }], bye: null }
  ]);
  assert.deepEqual(sheet.rows, [
    { table: 1, teamAIndex: 0, teamBIndex: 1, round: 1 },
    { table: 2, teamAIndex: 2, teamBIndex: 3, round: 1 },
    { table: 1, teamAIndex: 1, teamBIndex: 2, round: 2 }
  ]);
  assert.deepEqual(sheet.byes, [{ round: 1, teamIndex: 4 }]);
});

test("rotation keeps match numbers as table numbers even if listed out of order", () => {
  const sheet = rotationSheet([
    { matches: [{ a: 3, b: 1, n: 2 }, { a: 0, b: 2, n: 0 }], bye: -1 }
  ]);
  assert.deepEqual(sheet.rows.map((row) => [row.table, row.teamAIndex, row.teamBIndex, row.round]), [
    [1, 0, 2, 1],
    [3, 3, 1, 1]
  ]);
  assert.deepEqual(sheet.byes, []);
});
