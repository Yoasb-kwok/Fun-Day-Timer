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

  function scoredPlace(row) {
    const place = Number(row && row.place);
    if (!Number.isInteger(place) || place < 1) return { place: null, points: 0 };
    const points = Number(row.points);
    return { place, points: Number.isFinite(points) ? points : f1PointsForPlace(place) };
  }

  // Final total for one sport: F1 points for the electric place plus F1 points
  // for the manual place. An unplaced side adds 0. The sum is not scored again.
  function combinePlacePoints(electricRows, manualRows) {
    const byIndex = new Map();
    function ensure(row) {
      const index = row.index;
      if (!byIndex.has(index)) {
        byIndex.set(index, {
          index,
          name: row.name || "",
          tableNo: Number.isInteger(row.tableNo) ? row.tableNo : index + 1,
          electricPlace: null,
          electricPoints: 0,
          manualPlace: null,
          manualPoints: 0
        });
      }
      const current = byIndex.get(index);
      if (row.name) current.name = row.name;
      if (Number.isInteger(row.tableNo)) current.tableNo = row.tableNo;
      return current;
    }
    for (const row of electricRows || []) {
      const current = ensure(row);
      const scored = scoredPlace(row);
      current.electricPlace = scored.place;
      current.electricPoints = scored.points;
    }
    for (const row of manualRows || []) {
      const current = ensure(row);
      const scored = scoredPlace(row);
      current.manualPlace = scored.place;
      current.manualPoints = scored.points;
    }
    const placeKey = (place) => (place == null ? Number.MAX_SAFE_INTEGER : place);
    const ranked = [...byIndex.values()].map((row) => ({
      ...row,
      points: row.electricPoints + row.manualPoints
    }));
    ranked.sort((a, b) =>
      b.points - a.points
      || placeKey(a.electricPlace) - placeKey(b.electricPlace)
      || placeKey(a.manualPlace) - placeKey(b.manualPlace)
      || a.tableNo - b.tableNo
      || a.index - b.index
    );
    return ranked.map((row, index) => ({ ...row, order: index + 1 }));
  }

  // One row per team. Total is that team's F1 points on all four boards.
  // A board where the team has no place contributes 0. The sum is not scored again.
  function overallTeamTotals(teams) {
    const rows = (teams || []).map((team) => {
      const enduranceElectric = Number(team.enduranceElectric) || 0;
      const enduranceManual = Number(team.enduranceManual) || 0;
      const battleElectric = Number(team.battleElectric) || 0;
      const battleManual = Number(team.battleManual) || 0;
      return {
        ...team,
        enduranceElectric,
        enduranceManual,
        battleElectric,
        battleManual,
        points: enduranceElectric + enduranceManual + battleElectric + battleManual
      };
    });
    rows.sort((a, b) =>
      b.points - a.points
      || (Number(a.tableNo) || 0) - (Number(b.tableNo) || 0)
      || (Number(a.index) || 0) - (Number(b.index) || 0)
    );
    return rows.map((row, index) => ({ ...row, order: index + 1 }));
  }

  return {
    F1_POINTS,
    f1PointsForPlace,
    enduranceSortKey,
    rankEndurance,
    rankBattle,
    combinePlacePoints,
    overallTeamTotals
  };
});
