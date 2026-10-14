import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits as P,
  StringSelectMenuBuilder,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { RANKS } from '../roles/data.js';
import { checkAchievements } from '../achievements/index.js';
import { syncRank } from '../riot/index.js';
import { balancedSplit, randomSplit } from './teams.js';
import { POSITIONS, STARTERS, buildLobby } from './ui.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_PLAYERS = 20;
const STALE_HOURS = 12;

const getLobby = async (id) => (await query('SELECT * FROM custom_lobbies WHERE id = $1', [id])).rows[0];
const getPlayers = async (id) => (await query('SELECT * FROM custom_players WHERE lobby_id = $1 ORDER BY joined_at', [id])).rows;

const isStaff = (interaction, settings) =>
  interaction.memberPermissions?.has(P.Administrator) ||
  (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));

async function requireStaff(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (isStaff(interaction, settings)) return settings;
  await interaction.reply({ content: 'Tohle může jen tým (moderátoři a správci).', flags: EPHEMERAL });
  return null;
}

function rankFromMember(member, roleMap) {
  if (!roleMap) return null;
  for (let i = RANKS.lol.length - 1; i >= 0; i--) {
    if (member.roles.cache.has(roleMap[`rank:lol:${i}`])) return i;
  }
  return null;
}

// Počet hráčů, kteří hrají: první přihlášení, sudý počet, max. 10.
const pickStarters = (players) => {
  const n = Math.min(players.length, STARTERS);
  return players.slice(0, n - (n % 2));
};

export async function handleCustomInteraction(interaction) {
  const [, action, idRaw, extra] = interaction.customId.split(':');
  const id = Number(idRaw);
  switch (action) {
    case 'join': return join(interaction, id);
    case 'leave': return leave(interaction, id);
    case 'pos': return showPositions(interaction, id);
    case 'setpos': return setPositions(interaction, id);
    case 'split': return splitMenu(interaction, id);
    case 'dosplit': return doSplit(interaction, id, extra);
    case 'manual': return manualSplit(interaction, id);
    case 'move': return moveAgain(interaction, id);
    case 'win': return askWinner(interaction, id, extra);
    case 'confirm': return confirmWinner(interaction, id, extra);
    case 'dismiss': return interaction.update({ content: 'Zrušeno.', components: [] });
    case 'cancel': return cancel(interaction, id);
    case 'rematch': return rematch(interaction, id);
  }
}

/* ---------- Vytvoření a zveřejnění lobby ---------- */

async function postLobby(channel, { guildId, organizerId, mode, note }, players = []) {
  const { rows: [lobby] } = await query(
    'INSERT INTO custom_lobbies (guild_id, channel_id, organizer_id, mode, note) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [guildId, channel.id, organizerId, mode, note],
  );
  for (const p of players) {
    await query('INSERT INTO custom_players (lobby_id, user_id, positions, rank_idx) VALUES ($1, $2, $3, $4)', [lobby.id, p.user_id, p.positions, p.rank_idx]);
  }
  try {
    const message = await channel.send(buildLobby(lobby, await getPlayers(lobby.id)));
    await query('UPDATE custom_lobbies SET message_id = $1 WHERE id = $2', [message.id, lobby.id]);
    return message;
  } catch (err) {
    await query('DELETE FROM custom_lobbies WHERE id = $1', [lobby.id]);
    throw err;
  }
}

export async function createLobby(interaction) {
  if (!(await requireStaff(interaction))) return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const message = await postLobby(interaction.channel, {
    guildId: interaction.guildId,
    organizerId: interaction.user.id,
    mode: interaction.options.getString('rezim') ?? '5v5',
    note: interaction.options.getString('poznamka') ?? '',
  });
  await interaction.editReply(`Lobby je založené: ${message.url}`);
}

async function refreshLobby(client, lobbyId) {
  const lobby = await getLobby(lobbyId);
  if (!lobby) return;
  const channel = await client.channels.fetch(lobby.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(lobby.message_id).catch(() => null);
  await message?.edit(buildLobby(lobby, await getPlayers(lobbyId)));
}

/* ---------- Přihlášení hráčů ---------- */

async function join(interaction, id) {
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'open') {
    return interaction.reply({ content: 'Do tohoto lobby se už nejde přihlásit.', flags: EPHEMERAL });
  }
  const players = await getPlayers(id);
  if (players.length >= MAX_PLAYERS) return interaction.reply({ content: 'Lobby je plné, i s náhradníky.', flags: EPHEMERAL });

  const settings = await getSettings(interaction.guildId);
  const rank = rankFromMember(interaction.member, settings.roleMap);
  const ins = await query(
    'INSERT INTO custom_players (lobby_id, user_id, rank_idx) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1',
    [id, interaction.user.id, rank],
  );
  if (!ins.rowCount) return interaction.reply({ content: 'Už jsi přihlášený.', flags: EPHEMERAL });
  await interaction.update(buildLobby(lobby, await getPlayers(id)));
}

async function leave(interaction, id) {
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'open') {
    return interaction.reply({ content: 'Z tohoto lobby už se nejde odhlásit.', flags: EPHEMERAL });
  }
  const del = await query('DELETE FROM custom_players WHERE lobby_id = $1 AND user_id = $2', [id, interaction.user.id]);
  if (!del.rowCount) return interaction.reply({ content: 'V lobby nejsi.', flags: EPHEMERAL });
  await interaction.update(buildLobby(lobby, await getPlayers(id)));
}

async function showPositions(interaction, id) {
  const players = await getPlayers(id);
  const me = players.find((p) => p.user_id === interaction.user.id);
  if (!me) return interaction.reply({ content: 'Nejdřív se přihlas tlačítkem Připojit se.', flags: EPHEMERAL });
  const current = me.positions ? me.positions.split('/') : [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`custom:setpos:${id}`)
    .setPlaceholder('Vyber pozici (max. 2)…')
    .setMinValues(1)
    .setMaxValues(2)
    .addOptions(POSITIONS.map((p) => ({ label: p, value: p, default: current.includes(p) })));
  await interaction.reply({ content: 'Na jaké pozici chceš hrát? Zobrazí se u tvého jména v lobby.', components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
}

async function setPositions(interaction, id) {
  const upd = await query('UPDATE custom_players SET positions = $1 WHERE lobby_id = $2 AND user_id = $3', [interaction.values.join('/'), id, interaction.user.id]);
  if (!upd.rowCount) return interaction.update({ content: 'V lobby už nejsi.', components: [] });
  await refreshLobby(interaction.client, id);
  await interaction.update({ content: `Uloženo: ${interaction.values.join('/')}.`, components: [] });
}

/* ---------- Rozdělení týmů ---------- */

async function splitMenu(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const lobby = await getLobby(id);
  if (!lobby || !['open', 'teams'].includes(lobby.status)) return interaction.reply({ content: 'Toto lobby už je uzavřené.', flags: EPHEMERAL });
  const b = (method, label, style) => new ButtonBuilder().setCustomId(`custom:dosplit:${id}:${method}`).setLabel(label).setStyle(style);
  await interaction.reply({
    content: 'Jak mám hráče rozdělit?\n-# Podle ranku se bere rank LoL role, kterou si hráči zvolili v kanálu pro role.',
    components: [new ActionRowBuilder().addComponents(
      b('balanced', 'Podle ranku', ButtonStyle.Primary), b('random', 'Náhodně', ButtonStyle.Secondary), b('manual', 'Ručně', ButtonStyle.Secondary),
    )],
    flags: EPHEMERAL,
  });
}

async function doSplit(interaction, id, method) {
  const settings = await requireStaff(interaction);
  if (!settings) return;
  const lobby = await getLobby(id);
  if (!lobby || !['open', 'teams'].includes(lobby.status)) return interaction.update({ content: 'Toto lobby už je uzavřené.', components: [] });

  const starters = pickStarters(await getPlayers(id));
  if (starters.length < 2) return interaction.update({ content: 'Na rozdělení potřebuješ aspoň 2 hráče (sudý počet).', components: [] });

  if (method === 'manual') {
    const members = await interaction.guild.members.fetch({ user: starters.map((p) => p.user_id) }).catch(() => null);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`custom:manual:${id}`)
      .setPlaceholder(`Vyber ${starters.length / 2} hráčů do Blue Teamu…`)
      .setMinValues(starters.length / 2)
      .setMaxValues(starters.length / 2)
      .addOptions(starters.map((p) => ({ label: (members?.get(p.user_id)?.displayName ?? p.user_id).slice(0, 100), value: p.user_id })));
    return interaction.update({ content: 'Vyber hráče do **Blue Teamu**. Ostatní půjdou do Red Teamu.', components: [new ActionRowBuilder().addComponents(menu)] });
  }

  await interaction.deferUpdate();
  let candidates = starters;
  if (method === 'balanced') candidates = await refreshRanks(interaction.guild, starters, settings.roleMap);
  const { blue, red } = method === 'balanced' ? balancedSplit(candidates) : randomSplit(starters);
  await applyTeams(interaction.client, interaction.guild, lobby, blue, red, settings);
  await interaction.editReply({ content: 'Týmy jsou rozdělené.', components: [] });
}

async function manualSplit(interaction, id) {
  const settings = await requireStaff(interaction);
  if (!settings) return;
  const lobby = await getLobby(id);
  const starters = pickStarters(await getPlayers(id));
  const ids = starters.map((p) => p.user_id);
  const blue = interaction.values;
  if (!lobby || blue.length !== ids.length / 2 || !blue.every((u) => ids.includes(u))) {
    return interaction.update({ content: 'Složení lobby se mezitím změnilo. Zkus rozdělení znovu.', components: [] });
  }
  await interaction.deferUpdate();
  await applyTeams(interaction.client, interaction.guild, lobby, blue, ids.filter((u) => !blue.includes(u)), settings);
  await interaction.editReply({ content: 'Týmy jsou rozdělené.', components: [] });
}

// Před vyvažováním načte aktuální ranky: z Riot API u propojených účtů, jinak z rank rolí.
async function refreshRanks(guild, players, roleMap) {
  const synced = new Map();
  for (const p of players) synced.set(p.user_id, await syncRank(guild, p.user_id).catch(() => null));
  const members = await guild.members.fetch({ user: players.map((p) => p.user_id) }).catch(() => null);
  const out = [];
  for (const p of players) {
    const m = members?.get(p.user_id);
    const rank = synced.get(p.user_id) ?? (m ? rankFromMember(m, roleMap) : p.rank_idx);
    await query('UPDATE custom_players SET rank_idx = $1 WHERE lobby_id = $2 AND user_id = $3', [rank, p.lobby_id, p.user_id]);
    out.push({ ...p, rank_idx: rank });
  }
  return out;
}

async function applyTeams(client, guild, lobby, blue, red, settings) {
  await query(
    `UPDATE custom_players SET team = CASE WHEN user_id = ANY($2) THEN 'blue' WHEN user_id = ANY($3) THEN 'red' ELSE NULL END WHERE lobby_id = $1`,
    [lobby.id, blue, red],
  );
  await deleteVoices(client, lobby);

  // Soukromé roomky: vidí je a připojí se jen hráči týmu, tým (moderátoři) a bot.
  const lobbyChannel = await client.channels.fetch(lobby.channel_id);
  const makeVoice = (name, ids) => guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent: lobbyChannel.parentId ?? null,
    reason: 'Custom hra',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel, P.Connect] },
      ...ids.map((id) => ({ id, allow: [P.ViewChannel, P.Connect, P.Speak, P.SendMessages, P.ReadMessageHistory] })),
      ...(settings.staffRole ? [{ id: settings.staffRole, allow: [P.ViewChannel, P.Connect, P.MoveMembers, P.SendMessages] }] : []),
      { id: client.user.id, allow: [P.ViewChannel, P.Connect, P.ManageChannels, P.MoveMembers, P.SendMessages, P.ReadMessageHistory] },
    ],
  });
  const [voiceBlue, voiceRed] = await Promise.all([makeVoice('〉🔵| Blue Side', blue), makeVoice('〉🔴| Red Side', red)]);

  await query(
    `UPDATE custom_lobbies SET status = 'teams', winner = NULL, voice_blue = $2, voice_red = $3, voice_empty_since = now() WHERE id = $1`,
    [lobby.id, voiceBlue.id, voiceRed.id],
  );
  await moveToVoice(guild, blue, voiceBlue);
  await moveToVoice(guild, red, voiceRed);
  await refreshLobby(client, lobby.id);

  // Pozvánka přímo do chatu každé voice roomky, s označením týmu a soupiskou.
  const players = await getPlayers(lobby.id);
  const announce = (channel, emoji, side, ids) => {
    const roster = ids.map((id) => {
      const p = players.find((x) => x.user_id === id);
      return `<@${id}>${p?.positions ? ` · ${p.positions}` : ''}`;
    }).join('\n');
    return channel.send({
      content: `${emoji} **${side}**: tvůj tým je tady! ${ids.map((id) => `<@${id}>`).join(' ')}\n\n**Soupiska**\n${roster}\n\nPřipoj se do tohoto voice kanálu, hra brzy začne.`,
      allowedMentions: { users: ids },
    });
  };
  await Promise.all([announce(voiceBlue, '🔵', 'Blue Side', blue), announce(voiceRed, '🔴', 'Red Side', red)]);

  // V kanálu s lobby jen krátká informace bez označování.
  await lobbyChannel.send({
    content: `Týmy jsou rozdělené. Každý tým má svou soukromou voice roomku a označení najde v jejím chatu.\n🔵 ${voiceBlue} · 🔴 ${voiceRed}`,
    allowedMentions: { parse: [] },
    reply: { messageReference: lobby.message_id, failIfNotExists: false },
  });
}

// Přesune hráče, kteří jsou ve voice; vrací ty, které přesunout nešlo.
async function moveToVoice(guild, ids, channel) {
  const failed = [];
  for (const id of ids) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (member?.voice.channelId) {
      await member.voice.setChannel(channel).catch(() => failed.push(id));
    } else failed.push(id);
  }
  return failed;
}

async function deleteVoices(client, lobby) {
  for (const id of [lobby.voice_blue, lobby.voice_red]) {
    if (!id) continue;
    const channel = await client.channels.fetch(id).catch(() => null);
    await channel?.delete('Custom hra').catch(() => {});
  }
  await query('UPDATE custom_lobbies SET voice_blue = NULL, voice_red = NULL, voice_empty_since = NULL WHERE id = $1', [lobby.id]);
}

async function moveAgain(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'teams' || !lobby.voice_blue) return interaction.editReply('Voice roomky už neexistují.');
  const players = await getPlayers(id);
  const [blueCh, redCh] = await Promise.all([lobby.voice_blue, lobby.voice_red].map((c) => interaction.client.channels.fetch(c).catch(() => null)));
  if (!blueCh || !redCh) return interaction.editReply('Voice roomky se nepodařilo najít.');
  const failed = [
    ...(await moveToVoice(interaction.guild, players.filter((p) => p.team === 'blue').map((p) => p.user_id), blueCh)),
    ...(await moveToVoice(interaction.guild, players.filter((p) => p.team === 'red').map((p) => p.user_id), redCh)),
  ];
  await interaction.editReply(failed.length ? `Nepřesunul jsem (nejsou ve voice): ${failed.map((u) => `<@${u}>`).join(', ')}` : 'Všichni jsou přesunutí.');
}

/* ---------- Výsledek, zrušení, rematch ---------- */

async function askWinner(interaction, id, team) {
  if (!(await requireStaff(interaction))) return;
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'teams') return interaction.reply({ content: 'Výsledek už nejde zapsat.', flags: EPHEMERAL });
  const label = team === 'blue' ? '🔵 Blue Team' : '🔴 Red Team';
  await interaction.reply({
    content: `Potvrdit vítěze: **${label}**?`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`custom:confirm:${id}:${team}`).setLabel('Potvrdit').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('custom:dismiss').setLabel('Zrušit').setStyle(ButtonStyle.Secondary),
    )],
    flags: EPHEMERAL,
  });
}

async function confirmWinner(interaction, id, team) {
  if (!(await requireStaff(interaction))) return;
  const upd = await query(
    `UPDATE custom_lobbies SET status = 'finished', winner = $2, finished_at = now() WHERE id = $1 AND status = 'teams' RETURNING id`,
    [id, team],
  );
  if (!upd.rowCount) return interaction.update({ content: 'Výsledek už je zapsaný.', components: [] });
  await refreshLobby(interaction.client, id);
  for (const p of (await getPlayers(id)).filter((x) => x.team)) checkAchievements(interaction.client, interaction.guildId, p.user_id);
  await interaction.update({ content: 'Výsledek je uložený. Prázdné voice roomky se za chvíli samy smažou.', components: [] });
}

async function cancel(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const upd = await query(`UPDATE custom_lobbies SET status = 'cancelled' WHERE id = $1 AND status IN ('open', 'teams') RETURNING *`, [id]);
  if (!upd.rowCount) return interaction.reply({ content: 'Toto lobby už je uzavřené.', flags: EPHEMERAL });
  await interaction.update(buildLobby(upd.rows[0], await getPlayers(id)));
}

async function rematch(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'finished') return interaction.reply({ content: 'Nová hra už nejde založit.', flags: EPHEMERAL });
  await interaction.deferReply({ flags: EPHEMERAL });
  const players = (await getPlayers(id)).map((p) => ({ user_id: p.user_id, positions: p.positions, rank_idx: p.rank_idx }));
  const message = await postLobby(interaction.channel, {
    guildId: interaction.guildId, organizerId: interaction.user.id, mode: lobby.mode, note: lobby.note,
  }, players);
  await interaction.editReply(`Nové lobby se stejnými hráči: ${message.url}`);
}

/* ---------- Historie ---------- */

export async function showHistory(interaction) {
  const user = interaction.options.getUser('hrac');
  const winLabel = (w) => (w === 'blue' ? '🔵 Blue' : '🔴 Red');
  const when = (d) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:d>`;

  if (user) {
    const { rows: [stats] } = await query(
      `SELECT count(*)::int AS games, (count(*) FILTER (WHERE p.team = l.winner))::int AS wins
       FROM custom_players p JOIN custom_lobbies l ON l.id = p.lobby_id
       WHERE l.guild_id = $1 AND l.status = 'finished' AND p.user_id = $2 AND p.team IS NOT NULL`,
      [interaction.guildId, user.id],
    );
    if (!stats.games) return interaction.reply({ content: `<@${user.id}> zatím neodehrál žádnou custom hru.`, allowedMentions: { parse: [] } });
    const { rows: last } = await query(
      `SELECT l.id, l.winner, l.finished_at, p.team FROM custom_players p JOIN custom_lobbies l ON l.id = p.lobby_id
       WHERE l.guild_id = $1 AND l.status = 'finished' AND p.user_id = $2 AND p.team IS NOT NULL ORDER BY l.finished_at DESC LIMIT 5`,
      [interaction.guildId, user.id],
    );
    const rate = Math.round((stats.wins / stats.games) * 100);
    const lines = last.map((m) => `${m.team === m.winner ? 'Výhra' : 'Prohra'} · #${m.id} · ${when(m.finished_at)}`);
    return interaction.reply({
      content: `**Custom hry: <@${user.id}>**\n${stats.games} her · ${stats.wins} výher · ${rate} %\n\n${lines.join('\n')}`,
      allowedMentions: { parse: [] },
    });
  }

  const { rows } = await query(
    `SELECT id, mode, winner, finished_at FROM custom_lobbies WHERE guild_id = $1 AND status = 'finished' ORDER BY finished_at DESC LIMIT 10`,
    [interaction.guildId],
  );
  if (!rows.length) return interaction.reply({ content: 'Zatím nejsou žádné odehrané custom hry.', flags: EPHEMERAL });
  const lines = rows.map((m) => `**#${m.id}** · ${m.mode === 'aram' ? 'ARAM' : '5v5'} · vítěz ${winLabel(m.winner)} · ${when(m.finished_at)}`);
  await interaction.reply({ content: `**Posledních ${rows.length} custom her**\n${lines.join('\n')}` });
}

/* ---------- Úklid na pozadí ---------- */

async function sweep(client) {
  // Lobby, které nikdo nedohrál, po 12 hodinách zavřít.
  const { rows: stale } = await query(
    `UPDATE custom_lobbies SET status = 'cancelled' WHERE status IN ('open', 'teams') AND created_at < now() - ($1 || ' hours')::interval RETURNING id`,
    [String(STALE_HOURS)],
  );
  for (const l of stale) await refreshLobby(client, l.id).catch(console.error);

  // Voice roomky smazat, když jsou prázdné: 2 min po konci hry, 30 min během hry.
  const { rows: lobbies } = await query('SELECT * FROM custom_lobbies WHERE voice_blue IS NOT NULL OR voice_red IS NOT NULL');
  for (const lobby of lobbies) {
    try {
      const channels = (await Promise.all([lobby.voice_blue, lobby.voice_red].filter(Boolean).map((id) => client.channels.fetch(id).catch(() => null)))).filter(Boolean);
      const occupied = channels.reduce((sum, c) => sum + c.members.size, 0);
      if (occupied > 0) {
        if (lobby.voice_empty_since) await query('UPDATE custom_lobbies SET voice_empty_since = NULL WHERE id = $1', [lobby.id]);
        continue;
      }
      if (!lobby.voice_empty_since) {
        await query('UPDATE custom_lobbies SET voice_empty_since = now() WHERE id = $1', [lobby.id]);
        continue;
      }
      const limit = lobby.status === 'teams' ? 30 : 2;
      if (Date.now() - new Date(lobby.voice_empty_since).getTime() > limit * 60_000) await deleteVoices(client, lobby);
    } catch (err) { console.error(err); }
  }
}

export function startCustomSweeper(client) {
  const run = () => sweep(client).catch(console.error);
  run();
  setInterval(run, 60_000);
}
