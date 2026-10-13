// Rozdělení hráčů do dvou týmů. Čisté funkce bez Discordu, aby šly snadno testovat.

export function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// players: [{ user_id }]; vrací { blue: [ids], red: [ids] }
export function randomSplit(players) {
  const ids = shuffle(players.map((p) => p.user_id));
  const half = ids.length / 2;
  return { blue: ids.slice(0, half), red: ids.slice(half) };
}

// players: [{ user_id, rank_idx }] (rank_idx 0 = nejnižší, null = bez ranku)
// Hledá rozdělení s co nejmenším rozdílem součtu ranků. Mezi stejně dobrými vybírá náhodně,
// takže přelosování dá jiné složení.
export function balancedSplit(players) {
  const n = players.length;
  const k = n / 2;
  const known = players.filter((p) => p.rank_idx != null).map((p) => p.rank_idx + 1);
  const fallback = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : 4;
  const scores = players.map((p) => (p.rank_idx != null ? p.rank_idx + 1 : fallback));
  const total = scores.reduce((a, b) => a + b, 0);

  const combos = [];
  const picked = [];
  const rec = (start, sum) => {
    if (picked.length === k) {
      combos.push({ picked: [...picked], diff: Math.abs(total - 2 * sum) });
      return;
    }
    for (let i = start; i < n; i++) {
      picked.push(i);
      rec(i + 1, sum + scores[i]);
      picked.pop();
    }
  };
  rec(0, 0);

  const best = Math.min(...combos.map((c) => c.diff));
  const good = combos.filter((c) => c.diff <= best + 1);
  const choice = good[Math.floor(Math.random() * good.length)];
  const teamA = choice.picked.map((i) => players[i].user_id);
  const teamB = players.map((p) => p.user_id).filter((id) => !teamA.includes(id));
  return Math.random() < 0.5 ? { blue: teamA, red: teamB } : { blue: teamB, red: teamA };
}
