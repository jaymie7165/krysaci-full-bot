import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits as P,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { BAR } from '../../theme.js';
import { RANKS } from '../roles/data.js';
import { checkAchievements } from '../achievements/index.js';
import { syncRank } from '../riot/index.js';
import { balancedSplit, randomSplit, shuffle } from './teams.js';
import { POSITIONS, STARTERS, buildLobby } from './ui.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_PLAYERS = 20;
const STALE_HOURS = 12;
const EMPTY_AFTER_GAME_MIN = 2;   // hra skončila: prázdnou roomku mažeme po 2 minutách
const EMPTY_DURING_GAME_MIN = 15; // hra běží: mažeme, až když jsou prázdné obě roomky 15 minut
const BLUE_NAME = `〉🔵${BAR} Blue Side`;
const RED_NAME = `〉🔴${BAR} Red Side`;
// Pro ruční úklid rozpoznáváme i starší názvy s klasickou svislou čarou.
const ROOM_NAMES = [BLUE_NAME, RED_NAME, '〉🔵| Blue Side', '〉🔴| Red Side'];
const ROOMS = [
  { col: 'voice_blue', since: 'voice_blue_empty_since' },
  { col: 'voice_red', since: 'voice_red_empty_since' },
];

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
    case 'draftcaps': return startDraft(interaction, id, { mode: extra });
    case 'draftmanual': return startDraft(interaction, id, { captains: interaction.values });
    case 'pick': return pickPlayer(interaction, id);
    case 'draftauto': return draftAuto(interaction, id);
    case 'draftcancel': return draftCancel(interaction, id);
    case 'link': return showLinkModal(interaction, id);
    case 'linkmodal': return saveLink(interaction, id);
  }
}

/* ---------- Vytvoření a zveřejnění lobby ---------- */

async function postLobby(channel, { guildId, organizerId, mode, note, joinLink = null }, players = []) {
  const { rows: [lobby] } = await query(
    'INSERT INTO custom_lobbies (guild_id, channel_id, organizer_id, mode, note, join_link) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [guildId, channel.id, organizerId, mode, note, joinLink],
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
  await message?.edit(await lobbyPayload(client, lobby, await getPlayers(lobbyId)));
}

// Jména hráčů pro nabídku výběru v draftu.
async function namesFor(client, lobby, players) {
  const guild = client.guilds?.cache?.get(lobby.guild_id);
  const members = guild ? await guild.members.fetch({ user: players.map((p) => p.user_id) }).catch(() => null) : null;
  return Object.fromEntries(players.map((p) => [p.user_id, members?.get(p.user_id)?.displayName ?? p.user_id]));
}

const lobbyPayload = async (client, lobby, players) =>
  buildLobby(lobby, players, { names: lobby.status === 'draft' ? await namesFor(client, lobby, players) : {} });

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
      b('draft', 'Draft s kapitány', ButtonStyle.Success),
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

  if (method === 'draft') {
    if (starters.length < 4) return interaction.update({ content: 'Na draft potřebuješ aspoň 4 hráče (sudý počet).', components: [] });
    const members = await interaction.guild.members.fetch({ user: starters.map((p) => p.user_id) }).catch(() => null);
    const cb = (mode, label, style) => new ButtonBuilder().setCustomId(`custom:draftcaps:${id}:${mode}`).setLabel(label).setStyle(style);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`custom:draftmanual:${id}`)
      .setPlaceholder('Nebo vyber 2 kapitány ručně…')
      .setMinValues(2)
      .setMaxValues(2)
      .addOptions(starters.map((p) => ({ label: (members?.get(p.user_id)?.displayName ?? p.user_id).slice(0, 100), value: p.user_id })));
    return interaction.update({
      content: 'Kdo budou kapitáni?\n-# Kapitáni se střídají ve výběru (pořadí ABBA). Kapitán se slabším rankem vybírá první.',
      components: [
        new ActionRowBuilder().addComponents(cb('rank', 'Dva nejlepší podle ranku', ButtonStyle.Primary), cb('random', 'Náhodní kapitáni', ButtonStyle.Secondary)),
        new ActionRowBuilder().addComponents(menu),
      ],
    });
  }

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
      // Viditelné pro všechny (ať je vidět, že server žije), připojit se smí jen daný tým.
      { id: guild.roles.everyone.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.Connect, P.SendMessages] },
      ...ids.map((id) => ({ id, allow: [P.ViewChannel, P.Connect, P.Speak, P.SendMessages, P.ReadMessageHistory] })),
      ...(settings.staffRole ? [{ id: settings.staffRole, allow: [P.ViewChannel, P.Connect, P.MoveMembers, P.SendMessages] }] : []),
      { id: client.user.id, allow: [P.ViewChannel, P.Connect, P.ManageChannels, P.MoveMembers, P.SendMessages, P.ReadMessageHistory] },
    ],
  });
  const [voiceBlue, voiceRed] = await Promise.all([makeVoice(BLUE_NAME, blue), makeVoice(RED_NAME, red)]);

  await query(
    `UPDATE custom_lobbies SET status = 'teams', winner = NULL, voice_blue = $2, voice_red = $3, voice_empty_since = NULL, voice_blue_empty_since = now(), voice_red_empty_since = now() WHERE id = $1`,
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
      content: `${emoji} **${side}**: tvůj tým je tady! ${ids.map((id) => `<@${id}>`).join(' ')}\n\n**Soupiska**\n${roster}\n\nPřipoj se do tohoto voice kanálu, hra brzy začne.${lobby.join_link ? `\n🎮 Lobby v LoLu: ${lobby.join_link}` : ''}`,
      allowedMentions: { users: ids },
    });
  };
  await Promise.all([announce(voiceBlue, '🔵', 'Blue Side', blue), announce(voiceRed, '🔴', 'Red Side', red)]);

  // V kanálu s lobby jen krátká informace bez označování.
  await lobbyChannel.send({
    content: `Týmy jsou rozdělené. Každý tým má svou voice roomku (vidí ji všichni, připojit se smí jen daný tým) a označení najde v jejím chatu.\n🔵 ${voiceBlue} · 🔴 ${voiceRed}${lobby.join_link ? `\n🎮 Lobby v LoLu: ${lobby.join_link}` : ''}`,
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

// Načte roomku. Vrací { channel } nebo { gone: true }, když neexistuje (kód 10003). Jiné chyby (síť...) vyhazuje.
async function fetchRoom(client, id) {
  try {
    return { channel: await client.channels.fetch(id) };
  } catch (err) {
    if (err.code === 10003) return { gone: true };
    throw err;
  }
}

// Smaže jednu roomku a až po úspěchu ji odebere z databáze. Při selhání ji necháme, ať se to zkusí znovu.
async function deleteRoom(client, lobby, room, reason) {
  const id = lobby[room.col];
  if (!id) return true;
  try {
    const found = await fetchRoom(client, id);
    if (found.channel) await found.channel.delete(reason);
  } catch (err) {
    if (err.code !== 10003) {
      console.error(`Custom #${lobby.id}: roomku ${id} se nepodařilo smazat (${err.message}), zkusím to znovu.`);
      return false;
    }
  }
  await query(`UPDATE custom_lobbies SET ${room.col} = NULL, ${room.since} = NULL WHERE id = $1`, [lobby.id]);
  lobby[room.col] = null;
  return true;
}

async function deleteVoices(client, lobby) {
  for (const room of ROOMS) await deleteRoom(client, lobby, room, 'Custom hra');
}

async function moveAgain(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'teams' || !lobby.voice_blue || !lobby.voice_red) return interaction.editReply('Voice roomky už neexistují. Použij Znovu rozdělit, bot vytvoří nové.');
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
  const upd = await query(`UPDATE custom_lobbies SET status = 'cancelled' WHERE id = $1 AND status IN ('open', 'draft', 'teams') RETURNING *`, [id]);
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
    guildId: interaction.guildId, organizerId: interaction.user.id, mode: lobby.mode, note: lobby.note, joinLink: lobby.join_link,
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

export async function sweepCustomLobbies(client) {
  // Lobby, které nikdo nedohrál, po 12 hodinách zavřít.
  const { rows: stale } = await query(
    `UPDATE custom_lobbies SET status = 'cancelled' WHERE status IN ('open', 'draft', 'teams') AND created_at < now() - ($1 || ' hours')::interval RETURNING id`,
    [String(STALE_HOURS)],
  );
  for (const l of stale) await refreshLobby(client, l.id).catch(console.error);

  // Voice roomky: během hry se mažou, až když jsou prázdné obě; po konci hry každá zvlášť.
  const { rows: lobbies } = await query('SELECT * FROM custom_lobbies WHERE voice_blue IS NOT NULL OR voice_red IS NOT NULL');
  for (const lobby of lobbies) {
    try {
      await sweepLobbyRooms(client, lobby);
    } catch (err) { console.error(`Custom #${lobby.id}: úklid roomek selhal:`, err.message); }
  }
}

async function sweepLobbyRooms(client, lobby) {
  // Zjistíme stav obou roomek. Roomku, která už neexistuje, rovnou odebereme z databáze.
  const rooms = [];
  for (const room of ROOMS) {
    const id = lobby[room.col];
    if (!id) continue;
    const found = await fetchRoom(client, id);
    if (found.gone) {
      await query(`UPDATE custom_lobbies SET ${room.col} = NULL, ${room.since} = NULL WHERE id = $1`, [lobby.id]);
      lobby[room.col] = null;
      continue;
    }
    rooms.push({ ...room, channel: found.channel, since: lobby[room.since], sinceCol: room.since });
  }
  if (!rooms.length) return;

  const emptyFor = (r) => (r.since ? (Date.now() - new Date(r.since).getTime()) / 60_000 : null);
  const mark = (r, value) => query(`UPDATE custom_lobbies SET ${r.sinceCol} = ${value ? 'now()' : 'NULL'} WHERE id = $1`, [lobby.id]);

  // Hra běží: bereme obě roomky jako celek.
  if (lobby.status === 'teams') {
    const anyoneIn = rooms.some((r) => r.channel.members.size > 0);
    if (anyoneIn) {
      for (const r of rooms) if (r.since) await mark(r, false);
      return;
    }
    for (const r of rooms) if (!r.since) await mark(r, true);
    if (rooms.every((r) => (emptyFor(r) ?? 0) > EMPTY_DURING_GAME_MIN)) {
      console.log(`Custom #${lobby.id}: roomky jsou ${EMPTY_DURING_GAME_MIN} minut prázdné, mažu je.`);
      for (const r of rooms) await deleteRoom(client, lobby, ROOMS.find((x) => x.col === r.col), 'Custom hra: prázdná roomka');
      await refreshLobby(client, lobby.id).catch(console.error);
    }
    return;
  }

  // Hra skončila nebo byla zrušena: každá prázdná roomka se maže sama za sebe.
  for (const r of rooms) {
    if (r.channel.members.size > 0) {
      if (r.since) await mark(r, false);
    } else if (!r.since) {
      await mark(r, true);
    } else if (emptyFor(r) > EMPTY_AFTER_GAME_MIN) {
      console.log(`Custom #${lobby.id}: mažu prázdnou roomku ${r.channel.name}.`);
      await deleteRoom(client, lobby, ROOMS.find((x) => x.col === r.col), 'Custom hra skončila');
    }
  }
}

export function startCustomSweeper(client) {
  const run = () => sweepCustomLobbies(client).catch(console.error);
  run();
  setInterval(run, 60_000);
}

/* ---------- Ruční úklid zapomenutých roomek ---------- */

// Smaže prázdné roomky Blue/Red Side, které nepatří žádné běžící hře (např. zbylé po dřívější chybě).
export async function cleanupOrphans(interaction) {
  if (!(await requireStaff(interaction))) return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const { rows } = await query(`SELECT voice_blue, voice_red FROM custom_lobbies WHERE guild_id = $1 AND status = 'teams'`, [interaction.guildId]);
  const active = new Set(rows.flatMap((r) => [r.voice_blue, r.voice_red]).filter(Boolean));
  const channels = await interaction.guild.channels.fetch();
  let removed = 0;
  let occupied = 0;
  for (const channel of channels.values()) {
    if (!channel || !channel.isVoiceBased() || !ROOM_NAMES.includes(channel.name) || active.has(channel.id)) continue;
    if (channel.members.size > 0) { occupied++; continue; }
    await channel.delete('Ruční úklid zapomenutých custom roomek').then(() => removed++).catch((e) => console.error(e.message));
  }
  await interaction.editReply(
    `Smazáno prázdných roomek: **${removed}**.` + (occupied ? `\nPřeskočil jsem ${occupied}, protože jsou obsazené.` : ''),
  );
}

/* ---------- Odkaz do LoL lobby ---------- */

// Odkaz vytváří klient hry (Pozvat do lobby), bot ho jen sdílí. Musí vést na gg.riotgames.com.
export const isRiotLink = (value) => /^https:\/\/gg\.riotgames\.com\/[^\s]+$/i.test(String(value).trim());

async function showLinkModal(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const lobby = await getLobby(id);
  if (!lobby || !['open', 'draft', 'teams'].includes(lobby.status)) return interaction.reply({ content: 'Toto lobby už je uzavřené.', flags: EPHEMERAL });
  const input = new TextInputBuilder().setCustomId('url').setLabel('Odkaz z LoL (Pozvat do lobby)').setStyle(TextInputStyle.Short)
    .setRequired(true).setMaxLength(200).setPlaceholder('https://gg.riotgames.com/LOL?joinCode=…');
  if (lobby.join_link) input.setValue(lobby.join_link);
  await interaction.showModal(new ModalBuilder().setCustomId(`custom:linkmodal:${id}`).setTitle('Odkaz do LoL lobby').addComponents(new ActionRowBuilder().addComponents(input)));
}

async function saveLink(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const url = interaction.fields.getTextInputValue('url').trim();
  if (!isRiotLink(url)) {
    return interaction.reply({ content: 'Odkaz musí začínat `https://gg.riotgames.com/`. V LoL klikni v lobby na pozvání a zkopíruj odkaz.', flags: EPHEMERAL });
  }
  const upd = await query(`UPDATE custom_lobbies SET join_link = $2 WHERE id = $1 AND status IN ('open', 'draft', 'teams') RETURNING *`, [id, url]);
  if (!upd.rowCount) return interaction.reply({ content: 'Toto lobby už je uzavřené.', flags: EPHEMERAL });
  await refreshLobby(interaction.client, id);
  // Odkaz v běžné zprávě: Discord z něj sám udělá kartu s tlačítkem Spustit hru.
  await interaction.channel.send({ content: `🎮 **Lobby v LoLu je připravené.** Přidej se:\n${url}`, allowedMentions: { parse: [] } });
  await interaction.reply({ content: 'Odkaz je uložený a sdílený v kanálu.', flags: EPHEMERAL });
}

/* ---------- Draft s kapitány ---------- */

// Pořadí výběrů: A = kapitán, který vybírá první (Blue), B = druhý (Red). Vzor ABBA je vyrovnaný pro každý sudý počet.
export const draftOrder = (picks) => 'ABBA'.repeat(Math.ceil(picks / 4)).slice(0, picks);

async function startDraft(interaction, id, { mode, captains }) {
  const settings = await requireStaff(interaction);
  if (!settings) return;
  const lobby = await getLobby(id);
  if (!lobby || !['open', 'teams'].includes(lobby.status)) return interaction.update({ content: 'Toto lobby už je uzavřené.', components: [] });
  const starters = pickStarters(await getPlayers(id));
  if (starters.length < 4) return interaction.update({ content: 'Na draft potřebuješ aspoň 4 hráče (sudý počet).', components: [] });
  await interaction.deferUpdate();

  if (lobby.status === 'teams') await deleteVoices(interaction.client, lobby);
  const byRank = mode === 'rank' || Boolean(captains);
  const ranked = byRank ? await refreshRanks(interaction.guild, starters, settings.roleMap) : starters;
  const rankOf = (uid) => ranked.find((p) => p.user_id === uid)?.rank_idx ?? -1;

  let caps = captains;
  if (!caps) {
    caps = mode === 'rank'
      ? [...ranked].sort((a, b) => (b.rank_idx ?? -1) - (a.rank_idx ?? -1)).slice(0, 2).map((p) => p.user_id)
      : shuffle(starters).slice(0, 2).map((p) => p.user_id);
  }
  let [first, second] = caps;
  // Kapitán se slabším rankem vybírá první, při náhodném výběru rozhoduje los.
  if (byRank ? rankOf(first) > rankOf(second) : Math.random() < 0.5) [first, second] = [second, first];

  const order = draftOrder(starters.length - 2);
  await query('UPDATE custom_players SET team = NULL WHERE lobby_id = $1', [id]);
  await query(`UPDATE custom_players SET team = 'blue' WHERE lobby_id = $1 AND user_id = $2`, [id, first]);
  await query(`UPDATE custom_players SET team = 'red' WHERE lobby_id = $1 AND user_id = $2`, [id, second]);
  await query(
    `UPDATE custom_lobbies SET status = 'draft', winner = NULL, draft_blue = $2, draft_red = $3, draft_order = $4, draft_turn = 0 WHERE id = $1`,
    [id, first, second, order],
  );
  await refreshLobby(interaction.client, id);

  const channel = await interaction.client.channels.fetch(lobby.channel_id);
  await channel.send({
    content: `🎯 **Draft začíná!** Kapitáni: 🔵 <@${first}> a 🔴 <@${second}>. Jako první vybírá <@${first}>.`,
    allowedMentions: { users: [first, second] },
    reply: { messageReference: lobby.message_id, failIfNotExists: false },
  });
  await interaction.editReply({ content: 'Draft je spuštěný.', components: [] });
}

async function pickPlayer(interaction, id) {
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'draft') return interaction.reply({ content: 'Draft už neběží.', flags: EPHEMERAL });
  const order = lobby.draft_order;
  const turn = lobby.draft_turn;
  const side = order[turn] === 'A' ? 'blue' : 'red';
  const captain = side === 'blue' ? lobby.draft_blue : lobby.draft_red;
  if (interaction.user.id !== captain) {
    return interaction.reply({ content: `Teď vybírá <@${captain}>. Počkej, až budeš na řadě.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
  }

  const pick = interaction.values[0];
  const upd = await query(`UPDATE custom_players SET team = $3 WHERE lobby_id = $1 AND user_id = $2 AND team IS NULL RETURNING 1`, [id, pick, side]);
  if (!upd.rowCount) return interaction.reply({ content: 'Tento hráč už není k dispozici.', flags: EPHEMERAL });
  const next = await query('UPDATE custom_lobbies SET draft_turn = draft_turn + 1 WHERE id = $1 AND draft_turn = $2 RETURNING *', [id, turn]);
  const fresh = next.rows[0];

  if (fresh.draft_turn >= order.length) {
    await interaction.deferUpdate();
    return finishDraft(interaction.client, interaction.guild, fresh);
  }
  await interaction.update(await lobbyPayload(interaction.client, fresh, await getPlayers(id)));

  // Další kapitán se označí jen tehdy, když se střídá. Upozornění po chvíli zmizí, ať se kanál nezahlcuje.
  const nextCaptain = order[fresh.draft_turn] === 'A' ? fresh.draft_blue : fresh.draft_red;
  if (nextCaptain !== captain) {
    const note = await interaction.channel.send({ content: `<@${nextCaptain}> je na řadě s výběrem.`, allowedMentions: { users: [nextCaptain] } }).catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), 60_000);
  }
}

// Týmy jsou kompletní: vytvoří se roomky a hráči se přesunou jako při běžném rozdělení.
async function finishDraft(client, guild, lobby) {
  const settings = await getSettings(lobby.guild_id);
  const players = await getPlayers(lobby.id);
  const blue = players.filter((p) => p.team === 'blue').map((p) => p.user_id);
  const red = players.filter((p) => p.team === 'red').map((p) => p.user_id);
  await query('UPDATE custom_lobbies SET draft_blue = NULL, draft_red = NULL, draft_order = NULL, draft_turn = 0 WHERE id = $1', [lobby.id]);
  await applyTeams(client, guild, lobby, blue, red, settings);
}

async function draftAuto(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const lobby = await getLobby(id);
  if (!lobby || lobby.status !== 'draft') return interaction.reply({ content: 'Draft už neběží.', flags: EPHEMERAL });
  await interaction.deferUpdate();
  const players = await getPlayers(id);
  const pool = shuffle(pickStarters(players).filter((p) => !p.team));
  for (let turn = lobby.draft_turn; turn < lobby.draft_order.length; turn++) {
    const pick = pool.shift();
    if (!pick) break;
    await query(`UPDATE custom_players SET team = $3 WHERE lobby_id = $1 AND user_id = $2 AND team IS NULL`, [id, pick.user_id, lobby.draft_order[turn] === 'A' ? 'blue' : 'red']);
  }
  await finishDraft(interaction.client, interaction.guild, lobby);
}

async function draftCancel(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const { rows: [lobby] } = await query(
    `UPDATE custom_lobbies SET status = 'open', draft_blue = NULL, draft_red = NULL, draft_order = NULL, draft_turn = 0 WHERE id = $1 AND status = 'draft' RETURNING *`,
    [id],
  );
  if (!lobby) return interaction.reply({ content: 'Draft už neběží.', flags: EPHEMERAL });
  await query('UPDATE custom_players SET team = NULL WHERE lobby_id = $1', [id]);
  await interaction.update(buildLobby(lobby, await getPlayers(id)));
}
