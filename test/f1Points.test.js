const { test } = require("node:test");
const assert = require("node:assert/strict");
const { F1_POINTS, f1PointsForPlace, rankEndurance, rankBattle, combinePlacePoints, overallTeamTotals } = require("../lib/f1Points");

test("F1 place points match the default table and pay nothing from 11th", () => {
  assert.deepEqual([...F1_POINTS], [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(f1PointsForPlace),
    [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0]
  );
  assert.equal(f1PointsForPlace(0), 0);
  assert.equal(f1PointsForPlace(1.5), 0);
  assert.equal(f1PointsForPlace(null), 0);
});

test("endurance ranking pays F1 points from best-time order, once per category", () => {
  const rows = [
    { index: 0, tableNo: 1, time: 50000 },
    { index: 1, tableNo: 2, time: 90000 },
    { index: 2, tableNo: 3, time: 0 },
    { index: 3, tableNo: 4, time: 83450 },
    { index: 4, tableNo: 5, time: 4 }
  ];
  const ranked = rankEndurance(rows);
  assert.deepEqual(
    ranked.map((row) => [row.tableNo, row.place, row.points]),
    [
      [2, 1, 25],
      [4, 2, 18],
      [1, 3, 15],
      [3, null, 0],
      [5, null, 0]
    ]
  );
});

test("endurance ties keep the smaller table number ahead", () => {
  const ranked = rankEndurance([
    { index: 2, tableNo: 8, time: 12340 },
    { index: 0, tableNo: 3, time: 12344 },
    { index: 1, tableNo: 5, time: 12336 }
  ]);
  assert.deepEqual(ranked.map((row) => row.tableNo), [3, 5, 8]);
  assert.deepEqual(ranked.map((row) => row.points), [25, 18, 15]);
});

test("places 11 and later still rank but score 0", () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({
    index,
    tableNo: index + 1,
    time: (13 - index) * 1000
  }));
  const ranked = rankEndurance(rows);
  assert.equal(ranked[0].points, 25);
  assert.equal(ranked[9].place, 10);
  assert.equal(ranked[9].points, 1);
  assert.equal(ranked[10].place, 11);
  assert.equal(ranked[10].points, 0);
  assert.equal(ranked[12].place, 13);
  assert.equal(ranked[12].points, 0);
});

test("battle totals are F1 points for the classification, not 3 per win", () => {
  const idle = rankBattle([
    { index: 0, played: 0, wins: 0, gamesFor: 0, gamesAgainst: 0 },
    { index: 1, played: 0, wins: 0, gamesFor: 0, gamesAgainst: 0 }
  ]);
  assert.deepEqual(idle.map((row) => row.points), [0, 0]);
  assert.deepEqual(idle.map((row) => row.place), [null, null]);

  const ranked = rankBattle([
    { index: 0, name: "A", played: 2, wins: 2, gamesFor: 4, gamesAgainst: 1 },
    { index: 1, name: "B", played: 2, wins: 1, gamesFor: 3, gamesAgainst: 3 },
    { index: 2, name: "C", played: 1, wins: 0, gamesFor: 1, gamesAgainst: 2 },
    { index: 3, name: "D", played: 0, wins: 0, gamesFor: 0, gamesAgainst: 0 }
  ]);
  assert.deepEqual(ranked.map((row) => row.name), ["A", "B", "C", "D"]);
  assert.deepEqual(ranked.map((row) => [row.place, row.points]), [
    [1, 25],
    [2, 18],
    [3, 15],
    [null, 0]
  ]);
  assert.equal(ranked[0].points, 25);
  assert.notEqual(ranked[0].points, ranked[0].wins * 3);
});

test("combined total pairs electric place N with manual place N", () => {
  const electric = [
    { index: 0, name: "甲", place: 1, points: 25 },
    { index: 1, name: "乙", place: 2, points: 18 },
    { index: 2, name: "丙", place: null, points: 0 }
  ];
  const manual = [
    { index: 0, name: "甲", place: 3, points: 15 },
    { index: 1, name: "乙", place: 1, points: 25 },
    { index: 2, name: "丙", place: 11, points: 0 }
  ];
  const combined = combinePlacePoints(electric, manual);
  assert.deepEqual(combined.map((row) => [row.place, row.electricName, row.electricPoints, row.manualName, row.manualPoints, row.points]), [
    [1, "甲", 25, "乙", 25, 50],
    [2, "乙", 18, null, 0, 18],
    [3, null, 0, "甲", 15, 15],
    [11, null, 0, "丙", 0, 0]
  ]);
  assert.equal(combined[0].points, f1PointsForPlace(1) + f1PointsForPlace(1));
  assert.equal(combined.find((row) => row.place === 11).points, 0);
});

test("overall total sums one team's F1 points across all four boards", () => {
  const ranked = overallTeamTotals([
    { index: 0, name: "甲", tableNo: 1, enduranceElectric: 25, enduranceManual: 0, battleElectric: 18, battleManual: 0 },
    { index: 1, name: "乙", tableNo: 2, enduranceElectric: 18, enduranceManual: 15, battleElectric: 0, battleManual: 25 },
    { index: 2, name: "丙", tableNo: 3 }
  ]);
  assert.deepEqual(ranked.map((row) => [row.name, row.points, row.order]), [
    ["乙", 58, 1],
    ["甲", 43, 2],
    ["丙", 0, 3]
  ]);
  assert.equal(ranked[0].points, 18 + 15 + 0 + 25);
});

test("battle ties break by goal difference, games for, then team order", () => {
  const ranked = rankBattle([
    { index: 2, name: "later", played: 1, wins: 1, gamesFor: 2, gamesAgainst: 0 },
    { index: 0, name: "earlier", played: 1, wins: 1, gamesFor: 2, gamesAgainst: 0 },
    { index: 1, name: "diff", played: 1, wins: 1, gamesFor: 2, gamesAgainst: 1 }
  ]);
  assert.deepEqual(ranked.map((row) => row.name), ["earlier", "later", "diff"]);
  assert.deepEqual(ranked.map((row) => row.points), [25, 18, 15]);
});
