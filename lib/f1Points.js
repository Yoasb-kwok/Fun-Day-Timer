// Finish-position points for ranking totals.
// The repo has no configurable points table; this is the default F1 scale.
// Place 1..10 pay the listed points. Place 11 and later pay 0.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FunDayF1 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const F1_POINTS = Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);

  function f1PointsForPlace(place) {
    const position = Number(place);
    if (!Number.isInteger(position) || position < 1) return 0;
    return F1_POINTS[position - 1] || 0;
  }

  function withPlaces(ordered) {
    return ordered.map((row, index) => {
      const place = index + 1;
      return { ...row, place, points: f1PointsForPlace(place) };
    });
  }

  // Same centisecond key the previous endurance total used, so ties do not move.
  function enduranceSortKey(timeMs) {
    return Math.round((Number(timeMs) || 0) / 10) / 100;
  }

  function compareEndurance(a, b) {
    return enduranceSortKey(b.time) - enduranceSortKey(a.time)
      || a.tableNo - b.tableNo
      || a.index - b.index;
  }

  // One race per category. Longer time finishes ahead. No per-attempt sum:
  // the product keeps a single best time, then this assigns F1 points once.
  function rankEndurance(rows) {
    const classified = [];
    const pending = [];
    for (const row of rows || []) {
      if (enduranceSortKey(row.time) > 0) classified.push(row);
      else pending.push(row);
    }
    classified.sort(compareEndurance);
    pending.sort((a, b) => a.tableNo - b.tableNo || a.index - b.index);
    return [
      ...withPlaces(classified),
      ...pending.map((row) => ({ ...row, place: null, points: 0 }))
    ];
  }

  function battleDiff(row) {
    return (Number(row.gamesFor) || 0) - (Number(row.gamesAgainst) || 0);
  }

  function compareBattle(a, b) {
    return (Number(b.wins) || 0) - (Number(a.wins) || 0)
      || battleDiff(b) - battleDiff(a)
      || (Number(b.gamesFor) || 0) - (Number(a.gamesFor) || 0)
      || a.index - b.index;
  }

  // One classification per category. Match wins decide the order; the total
  // shown is F1 points for that place, not a sum of 3 per win. Teams with no
  // completed match are unplaced and do not take a points-paying place.
  function rankBattle(rows) {
    const classified = [];
    const pending = [];
    for (const row of rows || []) {
      if ((Number(row.played) || 0) > 0) classified.push(row);
      else pending.push(row);
    }
    classified.sort(compareBattle);
    pending.sort((a, b) => a.index - b.index);
    return [
      ...withPlaces(classified),
      ...pending.map((row) => ({ ...row, place: null, points: 0 }))
    ];
  }

  return {
    F1_POINTS,
    f1PointsForPlace,
    enduranceSortKey,
    rankEndurance,
    rankBattle
  };
});
