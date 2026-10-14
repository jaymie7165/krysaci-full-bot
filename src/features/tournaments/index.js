import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits as P, StringSelectMenuBuilder,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { checkAchievements } from '../achievements/index.js';
import { shuffle } from '../custom/teams.js';
import { syncRank } from '../riot/index.js';
import { lolRankFromMember } from '../roles/data.js';
import { roundRobin, singleElimination, snakeTeams, roundName } from './bracket.js';
import { MIN_PLAYERS, TEAM_SIZE, buildBracket, buildTournament } from './ui.js';

const EPHEMERAL = MessageFlags.Ephemeral;

const getT = async (id) => (await query('SELECT * FROM tournaments WHERE id = $1', [id])).rows[0];
const getPlayers = async (id) => (await query('SELECT * FROM tournament_players WHERE tournament_id = $1 ORDER BY joined_at', [id])).rows;
const getTeams = async (id) => (await query('SELECT * FROM tournament_teams WHERE tournament_id = $1 ORDER BY seed', [id])).rows;
const getMatches = async (id) => (await query('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, idx', [id])).rows;

async function requireStaff(interaction) {
  const settings = await getSettings(interaction.guildId);
  const ok = interaction.memberPermissions?.has(P.Administrator) || (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));
  if (ok) return settings;
  await interaction.reply({ content: 'Tohle může jen tým (moderátoři a správci).', flags: EPHEMERAL });
  return null;
}

export async function handleTournamentInteraction(interaction) {
  const [, action, a, b] = interaction.customId.split(':');
  const id = Number(a);
  switch (action) {
    case 'join': return join(interaction, id);
    case 'leave': return leave(interaction, id);
    case 'start': return start(interaction, id);
    case 'cancel': return cancel(interaction, id);
    case 'result': return resultMenu(interaction, id);
    case 'pickmatch': return pickMatch(interaction, id);
    case 'setwin': return setWin(interaction, id, Number(b));
  }
}

/* ---------- Založení a přihlášky ---------- */

export async function createTournament(interaction) {
  if (!(await requireStaff(interaction))) return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const role = interaction.options.getRole('role');
  const { rows: [t] } = await query(
    'INSERT INTO tournaments (guild_id, channel_id, name, format, max_players, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [
      interaction.guildId, interaction.channelId, interaction.options.getString('nazev', true),
      interaction.options.getString('format') ?? 'pavouk', interaction.options.getInteger('max_hracu') ?? 40, interaction.user.id,
    ],
  );
  try {
    const message = await interaction.channel.send({
      ...buildTournament(t, [], [], { ping: role ? `<@&${role.id}>` : undefined }),
      allowedMentions: { roles: role ? [role.id] : [] },
    });
    await query('UPDATE tournaments SET message_id = $1 WHERE id = $2', [message.id, t.id]);
    await interaction.editReply(`Turnaj je zveřejněný: ${message.url}`);
  } catch (err) {
    await query('DELETE FROM tournaments WHERE id = $1', [t.id]);
    throw err;
  }
}

async function join(interaction, id) {
  const t = await getT(id);
  if (!t || t.status !== 'signup') return interaction.reply({ content: 'Přihlášky už jsou uzavřené.', flags: EPHEMERAL });
  const players = await getPlayers(id);
  if (players.length >= t.max_players) return interaction.reply({ content: 'Turnaj je plný.', flags: EPHEMERAL });
  const settings = await getSettings(interaction.guildId);
  const rank = lolRankFromMember(interaction.member, settings.roleMap);
  const ins = await query('INSERT INTO tournament_players (tournament_id, user_id, rank_idx) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1', [id, interaction.user.id, rank]);
  if (!ins.rowCount) return interaction.reply({ content: 'Už jsi přihlášený.', flags: EPHEMERAL });
  await interaction.update(buildTournament(t, await getPlayers(id), []));
}

async function leave(interaction, id) {
  const t = await getT(id);
  if (!t || t.status !== 'signup') return interaction.reply({ content: 'Přihlášky už jsou uzavřené.', flags: EPHEMERAL });
  const del = await query('DELETE FROM tournament_players WHERE tournament_id = $1 AND user_id = $2', [id, interaction.user.id]);
  if (!del.rowCount) return interaction.reply({ content: 'Nejsi přihlášený.', flags: EPHEMERAL });
  await interaction.update(buildTournament(t, await getPlayers(id), []));
}

async function cancel(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const { rows: [t] } = await query(`UPDATE tournaments SET status = 'cancelled' WHERE id = $1 AND status IN ('signup', 'running') RETURNING *`, [id]);
  if (!t) return interaction.reply({ content: 'Turnaj už je uzavřený.', flags: EPHEMERAL });
  await interaction.update(buildTournament(t, await getPlayers(id), await getTeams(id)));
  await refreshBracket(interaction.client, t);
}

async function refreshBracket(client, t) {
  if (!t.bracket_message_id) return;
  const channel = await client.channels.fetch(t.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(t.bracket_message_id).catch(() => null);
  await message?.edit(buildBracket(t, await getTeams(t.id), await getMatches(t.id)));
}

async function refreshTournament(client, tid) {
  const t = await getT(tid);
  const channel = await client.channels.fetch(t.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(t.message_id).catch(() => null);
  await message?.edit(buildTournament(t, await getPlayers(tid), await getTeams(tid)));
  await refreshBracket(client, t);
  return { t, channel };
}

/* ---------- Losování týmů a pavouka ---------- */

async function start(interaction, id) {
  const settings = await requireStaff(interaction);
  if (!settings) return;
  const t = await getT(id);
  if (!t || t.status !== 'signup') return interaction.reply({ content: 'Turnaj už byl odstartován nebo uzavřen.', flags: EPHEMERAL });
  const players = await getPlayers(id);
  if (players.length < MIN_PLAYERS) {
    return interaction.reply({ content: `Na turnaj potřebuješ aspoň ${MIN_PLAYERS} přihlášených hráčů, teď je jich ${players.length}.`, flags: EPHEMERAL });
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  const guild = interaction.guild;

  // Aktuální ranky: Riot API pro propojené účty, jinak LoL rank role.
  const synced = new Map();
  for (const p of players) synced.set(p.user_id, await syncRank(guild, p.user_id).catch(() => null));
  const members = await guild.members.fetch({ user: players.map((p) => p.user_id) }).catch(() => null);
  const rated = players.map((p) => {
    const m = members?.get(p.user_id);
    const rank = synced.get(p.user_id) ?? (m ? lolRankFromMember(m, settings.roleMap) : p.rank_idx);
    return { ...p, rank_idx: rank ?? null, name: m?.displayName ?? p.user_id };
  });
  const known = rated.filter((p) => p.rank_idx != null).map((p) => p.rank_idx + 1);
  const fallback = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : 4;
  const scored = rated.map((p) => ({ ...p, score: (p.rank_idx ?? fallback - 1) + 1 }));

  // Hraje prvních (počet týmů × 5) přihlášených, ostatní jsou náhradníci.
  const teamCount = Math.floor(scored.length / TEAM_SIZE);
  const active = shuffle(scored.slice(0, teamCount * TEAM_SIZE)).sort((a, b) => b.score - a.score);
  const groups = snakeTeams(active, teamCount)
    .map((members) => ({ members, strength: members.reduce((s, p) => s + p.score, 0) }))
    .sort((a, b) => b.strength - a.strength);

  const used = new Set();
  const teamIds = [];
  for (let i = 0; i < groups.length; i++) {
    const captain = groups[i].members[0];
    let name = `Tým ${captain.name}`.slice(0, 40);
    if (used.has(name)) name = `${name} ${i + 1}`;
    used.add(name);
    const { rows: [team] } = await query('INSERT INTO tournament_teams (tournament_id, name, captain_id, seed) VALUES ($1, $2, $3, $4) RETURNING id', [id, name, captain.user_id, i + 1]);
    teamIds.push(team.id);
    for (const p of groups[i].members) {
      await query('UPDATE tournament_players SET team_id = $1, rank_idx = $2 WHERE tournament_id = $3 AND user_id = $4', [team.id, p.rank_idx, id, p.user_id]);
    }
  }
  for (const p of scored.slice(teamCount * TEAM_SIZE)) {
    await query('UPDATE tournament_players SET rank_idx = $1 WHERE tournament_id = $2 AND user_id = $3', [p.rank_idx, id, p.user_id]);
  }

  const matches = t.format === 'pavouk' ? singleElimination(teamIds) : roundRobin(teamIds);
  for (const m of matches) {
    await query('INSERT INTO tournament_matches (tournament_id, round, idx, team_a, team_b, winner) VALUES ($1, $2, $3, $4, $5, $6)', [id, m.round, m.idx, m.a, m.b, m.winner]);
  }
  await query(`UPDATE tournaments SET status = 'running' WHERE id = $1`, [id]);

  const channel = await interaction.client.channels.fetch(t.channel_id);
  const running = await getT(id);
  const bracketMessage = await channel.send(buildBracket(running, await getTeams(id), await getMatches(id)));
  await query('UPDATE tournaments SET bracket_message_id = $1 WHERE id = $2', [bracketMessage.id, id]);
  await refreshTournament(interaction.client, id);

  const teams = await getTeams(id);
  const name = (tid) => teams.find((x) => x.id === tid)?.name;
  const cap = (tid) => teams.find((x) => x.id === tid)?.captain_id;
  const ready = matches.filter((m) => m.round === 1 && m.a && m.b && !m.winner);
  const captains = ready.flatMap((m) => [cap(m.a), cap(m.b)]);
  await channel.send({
    content:
      `Týmy jsou vylosované! ${active.map((p) => `<@${p.user_id}>`).join(' ')}\n\n**První zápasy**\n` +
      ready.map((m) => `${name(m.a)} vs ${name(m.b)} · kapitáni <@${cap(m.a)}> <@${cap(m.b)}>`).join('\n'),
    allowedMentions: { users: [...new Set([...active.map((p) => p.user_id), ...captains])] },
  });
  await interaction.editReply('Týmy a rozpis jsou hotové.');
}

/* ---------- Zápis výsledků ---------- */

async function resultMenu(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const t = await getT(id);
  if (!t || t.status !== 'running') return interaction.reply({ content: 'Turnaj neběží.', flags: EPHEMERAL });
  const teams = await getTeams(id);
  const matches = await getMatches(id);
  const rounds = Math.max(...matches.map((m) => m.round));
  const name = (tid) => teams.find((x) => x.id === tid)?.name ?? '?';
  const ready = matches.filter((m) => m.team_a && m.team_b && !m.winner).slice(0, 25);
  if (!ready.length) return interaction.reply({ content: 'Žádný zápas teď nečeká na výsledek.', flags: EPHEMERAL });

  const menu = new StringSelectMenuBuilder().setCustomId(`tour:pickmatch:${id}`).setPlaceholder('Vyber zápas…').addOptions(
    ready.map((m) => ({
      label: `${t.format === 'pavouk' ? roundName(m.round, rounds) : `Kolo ${m.round}`} · ${name(m.team_a)} vs ${name(m.team_b)}`.slice(0, 100),
      value: String(m.id),
    })),
  );
  await interaction.reply({ content: 'Který zápas chceš zapsat?', components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
}

async function pickMatch(interaction, id) {
  const { rows: [m] } = await query('SELECT * FROM tournament_matches WHERE id = $1 AND tournament_id = $2', [Number(interaction.values[0]), id]);
  if (!m || m.winner) return interaction.update({ content: 'Tento zápas už má výsledek.', components: [] });
  const teams = await getTeams(id);
  const name = (tid) => teams.find((x) => x.id === tid)?.name ?? '?';
  const b = (teamId) => new ButtonBuilder().setCustomId(`tour:setwin:${m.id}:${teamId}`).setLabel(`Vyhrál ${name(teamId)}`.slice(0, 80)).setStyle(ButtonStyle.Primary);
  await interaction.update({ content: 'Kdo vyhrál?', components: [new ActionRowBuilder().addComponents(b(m.team_a), b(m.team_b))] });
}

async function setWin(interaction, matchId, teamId) {
  if (!(await requireStaff(interaction))) return;
  await interaction.deferUpdate();
  const { rows: [match] } = await query('UPDATE tournament_matches SET winner = $2 WHERE id = $1 AND winner IS NULL AND (team_a = $2 OR team_b = $2) RETURNING *', [matchId, teamId]);
  if (!match) return interaction.editReply({ content: 'Výsledek už je zapsaný, nebo tým do zápasu nepatří.', components: [] });

  const t = await getT(match.tournament_id);
  const all = await getMatches(t.id);
  let finished = null;

  if (t.format === 'pavouk') {
    const maxRound = Math.max(...all.map((m) => m.round));
    if (match.round === maxRound) finished = teamId;
    else {
      const slot = match.idx % 2 === 0 ? 'team_a' : 'team_b';
      const { rows: [next] } = await query(
        `UPDATE tournament_matches SET ${slot} = $4 WHERE tournament_id = $1 AND round = $2 AND idx = $3 RETURNING *`,
        [t.id, match.round + 1, Math.floor(match.idx / 2), teamId],
      );
      if (next?.team_a && next?.team_b) await announceNext(interaction.client, t, next);
    }
  } else if (all.every((m) => m.id === match.id || m.winner)) {
    const teams = await getTeams(t.id);
    const wins = new Map(teams.map((x) => [x.id, 0]));
    [...all.filter((m) => m.id !== match.id), match].forEach((m) => wins.set(m.winner, (wins.get(m.winner) ?? 0) + 1));
    finished = [...teams].sort((x, y) => wins.get(y.id) - wins.get(x.id) || x.seed - y.seed)[0].id;
  }

  if (finished) await finish(interaction.client, t, finished);
  else await refreshTournament(interaction.client, t.id);
  await interaction.editReply({ content: 'Výsledek je zapsaný.', components: [] });
}

async function announceNext(client, t, match) {
  const teams = await getTeams(t.id);
  const a = teams.find((x) => x.id === match.team_a);
  const b = teams.find((x) => x.id === match.team_b);
  const channel = await client.channels.fetch(t.channel_id).catch(() => null);
  await channel?.send({
    content: `Další zápas: **${a.name}** vs **${b.name}**\nKapitáni: <@${a.captain_id}> <@${b.captain_id}>`,
    allowedMentions: { users: [a.captain_id, b.captain_id] },
  });
}

async function finish(client, t, winnerTeamId) {
  await query(`UPDATE tournaments SET status = 'finished', winner_team = $2 WHERE id = $1`, [t.id, winnerTeamId]);
  const { channel } = await refreshTournament(client, t.id);
  const teams = await getTeams(t.id);
  const players = await getPlayers(t.id);
  const winner = teams.find((x) => x.id === winnerTeamId);
  const winners = players.filter((p) => p.team_id === winnerTeamId).map((p) => p.user_id);
  await channel?.send({
    content: `Turnaj **${t.name}** vyhrál **${winner.name}**! Gratulace: ${winners.map((u) => `<@${u}>`).join(' ')}`,
    allowedMentions: { users: winners },
  });
  for (const p of players.filter((x) => x.team_id)) await checkAchievements(client, t.guild_id, p.user_id);
}
