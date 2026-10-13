// Two sides, each with its own tables 1–6. Twelve tables in the room.
// Manual does not continue as 7–12, and the two sides are not one shared 1–12.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FunDayRotation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TABLES_PER_SIDE = 6;

  function rotationSheet(schedule) {
    const rows = [];
    const overflow = [];
    const byes = [];
    (schedule || []).forEach((round, roundIndex) => {
      const matches = (round.matches || []).slice().sort((a, b) => {
        const aNum = Number.isInteger(a.n) ? a.n : 0;
        const bNum = Number.isInteger(b.n) ? b.n : 0;
        return aNum - bNum;
      });
      matches.forEach((match, index) => {
        const table = (Number.isInteger(match.n) ? match.n : index) + 1;
        const entry = {
          table,
          teamAIndex: match.a,
          teamBIndex: match.b,
          round: roundIndex + 1
        };
        if (table >= 1 && table <= TABLES_PER_SIDE) rows.push(entry);
        else overflow.push(entry);
      });
      if (Number.isInteger(round.bye) && round.bye >= 0) {
        byes.push({ round: roundIndex + 1, teamIndex: round.bye });
      }
    });
    return { rows, overflow, byes };
  }

  // One scannable list: same table's pairings stay together, round after round.
  // Electric and manual stay in that order so table 1 on each side is not merged.
  function scanRows(sides) {
    const rows = [];
    for (const side of sides || []) {
      for (const row of side.rows || []) {
        rows.push({
          ...row,
          side: side.side,
          sideLabel: side.label || side.side
        });
      }
    }
    rows.sort((a, b) =>
      String(a.side).localeCompare(String(b.side))
      || a.table - b.table
      || a.round - b.round
    );
    return rows;
  }

  // Remaining rounds for one table, starting at the current round.
  function upcomingForTable(rows, { table, fromRound = 1 } = {}) {
    const start = Number(fromRound) || 1;
    return (rows || [])
      .filter((row) => row.table === table && row.round >= start)
      .slice()
      .sort((a, b) => a.round - b.round);
  }

  return { TABLES_PER_SIDE, rotationSheet, scanRows, upcomingForTable };
});
