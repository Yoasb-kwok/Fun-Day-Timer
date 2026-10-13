// Circle-method round robin, matching the previous Supabase schedule function.
// teamIds are ordered by team number. A 0 slot is a bye when the field is odd.
function buildSchedule(teamIds, requestedRounds) {
  const teamCount = teamIds.length;
  if (teamCount < 2) {
    return { rounds: 0, matches: [] };
  }
  const maximum = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
  const rounds = Math.max(1, Math.min(Number(requestedRounds) || 1, maximum));
  let rotation = Array.from({ length: teamCount }, (_, index) => index + 1);
  if (teamCount % 2 === 1) rotation.push(0);
  const matches = [];

  for (let roundIdx = 0; roundIdx < rounds; roundIdx += 1) {
    const slotCount = rotation.length;
    let matchIdx = 0;
    for (let pairIdx = 1; pairIdx <= slotCount / 2; pairIdx += 1) {
      const a = rotation[pairIdx - 1];
      const b = rotation[slotCount - pairIdx];
      if (a > 0 && b > 0) {
        const left = roundIdx % 2 === 0 ? a : b;
        const right = roundIdx % 2 === 0 ? b : a;
        matches.push({
          roundNumber: roundIdx,
          matchNumber: matchIdx,
          teamAId: teamIds[left - 1],
          teamBId: teamIds[right - 1]
        });
        matchIdx += 1;
      }
    }
    const first = rotation[0];
    const last = rotation[rotation.length - 1];
    const middle = rotation.slice(1, rotation.length - 1);
    rotation = [first, last, ...middle];
  }

  return { rounds, matches };
}

module.exports = { buildSchedule };
