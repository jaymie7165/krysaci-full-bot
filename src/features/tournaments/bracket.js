// Generování pavouka a ligy. Čisté funkce bez Discordu a databáze.

export function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Pořadí nasazení v prvním kole: [1, 8, 4, 5, 2, 7, 3, 6] pro 8 týmů.
export function seedOrder(p) {
  let order = [1];
  while (order.length < p) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

// Doplní vítěze do dalšího zápasu (v paměti).
export function advanceInMemory(matches, match, winner) {
  const next = matches.find((m) => m.round === match.round + 1 && m.idx === Math.floor(match.idx / 2));
  if (!next) return null;
  if (match.idx % 2 === 0) next.a = winner;
  else next.b = winner;
  return next;
}

// teams: id týmů seřazené podle nasazení (první = nejsilnější). Volné postupy jsou rovnou vyřešené.
export function singleElimination(teams) {
  const n = teams.length;
  const p = nextPow2(n);
  const rounds = Math.log2(p);
  const order = seedOrder(p);
  const matches = [];
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < p / 2 ** r; i++) matches.push({ round: r, idx: i, a: null, b: null, winner: null });
  }
  const first = matches.filter((m) => m.round === 1);
  first.forEach((m, i) => {
    const sa = order[2 * i];
    const sb = order[2 * i + 1];
    m.a = sa <= n ? teams[sa - 1] : null;
    m.b = sb <= n ? teams[sb - 1] : null;
  });
  for (const m of first) {
    if (m.a && !m.b) m.winner = m.a;
    else if (!m.a && m.b) m.winner = m.b;
    if (m.winner) advanceInMemory(matches, m, m.winner);
  }
  return matches;
}

// Liga: každý s každým, rozpis po kolech (metoda kruhu).
export function roundRobin(teams) {
  const t = [...teams];
  if (t.length % 2) t.push(null);
  const n = t.length;
  const out = [];
  for (let r = 0; r < n - 1; r++) {
    let idx = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = t[i];
      const b = t[n - 1 - i];
      if (a && b) out.push({ round: r + 1, idx: idx++, a, b, winner: null });
    }
    t.splice(1, 0, t.pop());
  }
  return out;
}

export function roundName(round, totalRounds) {
  const left = totalRounds - round;
  if (left === 0) return 'Finále';
  if (left === 1) return 'Semifinále';
  if (left === 2) return 'Čtvrtfinále';
  return `Kolo ${round}`;
}

// Rozdělí hráče do týmů "hadím" losováním podle síly. scores: [{ id, score }] seřazené sestupně.
export function snakeTeams(players, teamCount) {
  const teams = Array.from({ length: teamCount }, () => []);
  players.forEach((p, i) => {
    const round = Math.floor(i / teamCount);
    const pos = i % teamCount;
    teams[round % 2 === 0 ? pos : teamCount - 1 - pos].push(p);
  });
  return teams;
}
