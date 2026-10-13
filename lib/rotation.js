// Printable battle rotation: one row per table in a round.
// Table number follows the schedule match number (first court is table 1).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FunDayRotation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function rotationSheet(schedule) {
    const rows = [];
    const byes = [];
    (schedule || []).forEach((round, roundIndex) => {
      const matches = (round.matches || []).slice().sort((a, b) => {
        const aNum = Number.isInteger(a.n) ? a.n : 0;
        const bNum = Number.isInteger(b.n) ? b.n : 0;
        return aNum - bNum;
      });
      matches.forEach((match, index) => {
        rows.push({
          table: Number.isInteger(match.n) ? match.n + 1 : index + 1,
          teamAIndex: match.a,
          teamBIndex: match.b,
          round: roundIndex + 1
        });
      });
      if (Number.isInteger(round.bye) && round.bye >= 0) {
        byes.push({ round: roundIndex + 1, teamIndex: round.bye });
      }
    });
    return { rows, byes };
  }

  return { rotationSheet };
});
