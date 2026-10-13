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

test("each side is tables 1-6, never a shared 1-12", () => {
  const { TABLES_PER_SIDE } = require("../lib/rotation");
  assert.equal(TABLES_PER_SIDE, 6);
  const eight = Array.from({ length: 8 }, (_, n) => ({ a: n, b: n + 20, n }));
  const electric = rotationSheet([{ matches: eight, bye: null }]);
  const manual = rotationSheet([{ matches: eight, bye: null }]);
  assert.deepEqual(electric.rows.map((row) => row.table), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(manual.rows.map((row) => row.table), [1, 2, 3, 4, 5, 6]);
  assert.equal(electric.overflow.length, 2);
  assert.equal(manual.overflow.length, 2);
  assert.ok(electric.rows.every((row) => row.table <= 6));
  assert.ok(manual.rows.every((row) => row.table <= 6));
});

test("scan order keeps one table's pairings together, electric then manual", () => {
  const { scanRows } = require("../lib/rotation");
  const rows = scanRows([
    {
      side: "electric",
      label: "電動組",
      rows: [
        { table: 2, teamAIndex: 1, teamBIndex: 2, round: 1 },
        { table: 1, teamAIndex: 0, teamBIndex: 3, round: 2 },
        { table: 1, teamAIndex: 4, teamBIndex: 5, round: 1 }
      ]
    },
    {
      side: "manual",
      label: "手動組",
      rows: [{ table: 1, teamAIndex: 6, teamBIndex: 7, round: 1 }]
    }
  ]);
  assert.deepEqual(rows.map((row) => [row.side, row.table, row.round, row.teamAIndex, row.teamBIndex]), [
    ["electric", 1, 1, 4, 5],
    ["electric", 1, 2, 0, 3],
    ["electric", 2, 1, 1, 2],
    ["manual", 1, 1, 6, 7]
  ]);
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
