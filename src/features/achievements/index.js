import { getSettings, query } from '../../db.js';

// Milníky se udělují automaticky podle toho, co člen v komunitě dělá.
export const ACHIEVEMENTS = [
  { key: 'linked', name: 'Propojený summoner', desc: 'Propojil(a) svůj LoL účet.', test: (m) => m.linked > 0 },
  { key: 'lfg_first', name: 'Hledač', desc: 'Založil(a) první hledání spoluhráčů.', test: (m) => m.lfgPosts >= 1 },
  { key: 'lfg_team', name: 'Týmový hráč', desc: 'Připojil(a) se do 5 part.', test: (m) => m.lfgJoined >= 5 },
  { key: 'custom_first', name: 'Nováček v customkách', desc: 'Odehrál(a) první custom hru.', test: (m) => m.customGames >= 1 },
  { key: 'custom_10', name: 'Matador customek', desc: 'Odehrál(a) 10 custom her.', test: (m) => m.customGames >= 10 },
  { key: 'custom_wins5', name: 'Vítěz', desc: 'Vyhrál(a) 5 custom her.', test: (m) => m.customWins >= 5 },
  { key: 'event_first', name: 'Na místě', desc: 'Zúčastnil(a) se prvního eventu.', test: (m) => m.events >= 1 },
  { key: 'event_5', name: 'Štamgast', desc: 'Zúčastnil(a) se 5 eventů.', test: (m) => m.events >= 5 },
  { key: 'tour_play', name: 'Turnajový hráč', desc: 'Odehrál(a) turnaj.', test: (m) => m.tourPlayed >= 1 },
  { key: 'tour_win', name: 'Šampion', desc: 'Vyhrál(a) turnaj.', test: (m) => m.tourWins >= 1 },
  { key: 'suggest_first', name: 'Hlas komunity', desc: 'Poslal(a) první návrh.', test: (m) => m.suggestions >= 1 },
  { key: 'suggest_ok', name: 'Nápad, který vyšel', desc: 'Jeho/její návrh byl schválen.', test: (m) => m.suggestionsOk >= 1 },
];

export async function metrics(guildId, userId) {
  const one = async (sql) => (await query(sql, [guildId, userId])).rows[0];
  const lfg = await one(`SELECT
    (SELECT count(*) FROM lfg_posts WHERE guild_id = $1 AND founder_id = $2)::int AS posts,
    (SELECT count(*) FROM lfg_members m JOIN lfg_posts p ON p.id = m.post_id WHERE p.guild_id = $1 AND m.user_id = $2)::int AS joined`);
  const custom = await one(`SELECT count(*)::int AS games, (count(*) FILTER (WHERE p.team = l.winner))::int AS wins
    FROM custom_players p JOIN custom_lobbies l ON l.id = p.lobby_id
    WHERE l.guild_id = $1 AND l.status = 'finished' AND p.user_id = $2 AND p.team IS NOT NULL`);
  const events = await one(`SELECT count(*)::int AS n FROM event_signups s JOIN events e ON e.id = s.event_id
    WHERE e.guild_id = $1 AND s.user_id = $2 AND s.attended`);
  const sug = await one(`SELECT count(*)::int AS total, (count(*) FILTER (WHERE status IN ('approved', 'done')))::int AS ok
    FROM suggestions WHERE guild_id = $1 AND author_id = $2`);
  const tour = await one(`SELECT count(*)::int AS played, (count(*) FILTER (WHERE t.winner_team = tp.team_id))::int AS wins
    FROM tournament_players tp JOIN tournaments t ON t.id = tp.tournament_id
    WHERE t.guild_id = $1 AND tp.user_id = $2 AND tp.team_id IS NOT NULL AND t.status = 'finished'`);
  const linked = await one('SELECT count(*)::int AS n FROM riot_links WHERE guild_id = $1 AND user_id = $2 AND verified');
  return {
    lfgPosts: lfg.posts, lfgJoined: lfg.joined, customGames: custom.games, customWins: custom.wins,
    events: events.n, suggestions: sug.total, suggestionsOk: sug.ok,
    tourPlayed: tour.played, tourWins: tour.wins, linked: linked.n,
  };
}

export async function earnedKeys(guildId, userId) {
  const { rows } = await query('SELECT key FROM achievements WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return rows.map((r) => r.key);
}

// Ověří a udělí nové milníky. Nikdy nevyhazuje chybu, aby nerozbil akci, ze které je volána.
export async function checkAchievements(client, guildId, userId) {
  try {
    const m = await metrics(guildId, userId);
    const have = new Set(await earnedKeys(guildId, userId));
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (have.has(a.key) || !a.test(m)) continue;
      const ins = await query('INSERT INTO achievements (guild_id, user_id, key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1', [guildId, userId, a.key]);
      if (ins.rowCount) fresh.push(a);
    }
    if (!fresh.length) return;
    const { achievementChannel } = await getSettings(guildId);
    const channel = achievementChannel ? await client.channels.fetch(achievementChannel).catch(() => null) : null;
    for (const a of fresh) {
      await channel?.send({ content: `Nový milník pro <@${userId}>: **${a.name}**\n-# ${a.desc}`, allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error('Achievements:', err);
  }
}
