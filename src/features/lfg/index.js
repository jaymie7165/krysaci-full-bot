import {
  ActionRowBuilder, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits as P,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { GAMES, RANKS, gameById } from '../roles/data.js';
import { checkAchievements } from '../achievements/index.js';
import { buildPost } from './ui.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const EXPIRE_HOURS = 24;
const MAX_CAPACITY = 99; // stejný strop jako limit míst ve voice kanálu na Discordu
const MENTIONS_PER_MESSAGE = 60;
const VOICE_EMPTY_MINUTES = 5;
const postUrl = (p) => `https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id}`;

const getPost = async (id) => (await query('SELECT * FROM lfg_posts WHERE id = $1', [id])).rows[0];
const getMembers = async (id) => (await query('SELECT * FROM lfg_members WHERE post_id = $1 ORDER BY joined_at', [id])).rows;

export async function handleLfgInteraction(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  switch (action) {
    case 'new': return startLfg(interaction);
    case 'game': return showModal(interaction);
    case 'create': return createPost(interaction, arg);
    case 'join': return join(interaction, Number(arg));
    case 'leave': return leave(interaction, Number(arg));
    case 'players': return players(interaction, Number(arg));
    case 'close': return close(interaction, Number(arg));
  }
}

/* ---------- Založení hledání ---------- */

// Společný vstup pro příkaz /lfg i tlačítko na panelu.
export async function startLfg(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!settings.lfgChannel) {
    return interaction.reply({ content: 'Hledání spoluhráčů ještě není nastavené. Napiš prosím správci serveru.', flags: EPHEMERAL });
  }
  const { rows } = await query(
    `SELECT * FROM lfg_posts WHERE guild_id = $1 AND founder_id = $2 AND status = 'open'`,
    [interaction.guildId, interaction.user.id],
  );
  if (rows.length) {
    return interaction.reply({ content: `Už máš aktivní hledání: ${postUrl(rows[0])}\nNejdřív ho zavři, nebo počkej, až se naplní.`, flags: EPHEMERAL });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('lfg:game')
    .setPlaceholder('Vyber hru…')
    .addOptions([
      ...GAMES.map((g) => ({ label: g.name, value: g.id })),
      { label: 'Jiná hra nebo aktivita', value: 'other' },
    ]);
  await interaction.reply({ content: 'Na jakou hru hledáš spoluhráče?', components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
}

const input = (id, label, { style = TextInputStyle.Short, required = true, placeholder } = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(100);
  if (placeholder) t.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(t);
};

async function showModal(interaction) {
  const gameId = interaction.values[0];
  const other = gameId === 'other';
  const game = other ? null : gameById(gameId);
  const modal = new ModalBuilder().setCustomId(`lfg:create:${gameId}`).setTitle(other ? 'Hledání spoluhráčů' : game.name.slice(0, 45));
  if (other) modal.addComponents(input('name', 'Název hry nebo aktivity', { placeholder: 'Např. Minecraft nebo koukání na film' }));
  modal.addComponents(
    input('capacity', 'Kolik hráčů celkem (včetně tebe)?', { placeholder: `Např. 5 (nejvíc ${MAX_CAPACITY})` }),
    input('mode', 'Režim', { required: false, placeholder: 'Např. Competitive, casual' }),
  );
  if (!other) {
    modal.addComponents(input('rank', RANKS[gameId] ? 'Rank' : 'Obtížnost', { required: false, placeholder: RANKS[gameId] ? 'Např. Gold–Platinum' : 'Pokud je relevantní' }));
  }
  modal.addComponents(
    input('time', 'Kdy chceš hrát?', { required: false, placeholder: 'Např. dnes 20:00 (prázdné = co nejdřív)' }),
    input('vibe', 'Atmosféra', { required: false, placeholder: 'Např. Chill, ale chceme vyhrávat' }),
  );
  await interaction.showModal(modal);
}

async function createPost(interaction, gameId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const settings = await getSettings(interaction.guildId);
  const channel = await interaction.guild.channels.fetch(settings.lfgChannel).catch(() => null);
  if (!channel) return interaction.editReply('LFG kanál se nepodařilo najít. Napiš prosím správci serveru.');

  const f = (id) => interaction.fields.getTextInputValue(id).trim();
  const other = gameId === 'other';
  const gameName = other ? f('name') : gameById(gameId).name;
  const capacity = Number.parseInt(f('capacity'), 10);
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > MAX_CAPACITY) {
    return interaction.editReply(`Počet hráčů musí být číslo od 2 do ${MAX_CAPACITY}. Zkus to prosím znovu.`);
  }

  const { rows: existing } = await query(
    `SELECT 1 FROM lfg_posts WHERE guild_id = $1 AND founder_id = $2 AND status = 'open'`,
    [interaction.guildId, interaction.user.id],
  );
  if (existing.length) return interaction.editReply('Už máš aktivní hledání.');

  const { rows: [post] } = await query(
    `INSERT INTO lfg_posts (guild_id, channel_id, founder_id, game_id, game_name, capacity, mode_text, rank_text, time_text, vibe_text, founder_avatar)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      interaction.guildId, channel.id, interaction.user.id, gameId, gameName, capacity,
      f('mode'), other ? '' : f('rank'), f('time') || 'Co nejdřív', f('vibe'),
      interaction.member.displayAvatarURL({ size: 128 }),
    ],
  );
  await query('INSERT INTO lfg_members (post_id, user_id) VALUES ($1, $2)', [post.id, interaction.user.id]);

  try {
    const roleId = other ? null : settings.roleMap?.[`game:${gameId}`];
    const members = await getMembers(post.id);
    const message = await channel.send({
      ...buildPost(post, members, { ping: roleId ? `<@&${roleId}>` : undefined }),
      allowedMentions: { roles: roleId ? [roleId] : [] },
    });
    await query('UPDATE lfg_posts SET message_id = $1 WHERE id = $2', [message.id, post.id]);
    await interaction.editReply(`Hledání je zveřejněné: ${message.url}`);
    checkAchievements(interaction.client, interaction.guildId, interaction.user.id);
  } catch (err) {
    await query('DELETE FROM lfg_posts WHERE id = $1', [post.id]);
    throw err;
  }
}

/* ---------- Tlačítka na příspěvku ---------- */

const inactive = (interaction) => interaction.reply({ content: 'Toto hledání už není aktivní.', flags: EPHEMERAL });

async function join(interaction, id) {
  const post = await getPost(id);
  if (!post || post.status !== 'open') return inactive(interaction);

  const ins = await query('INSERT INTO lfg_members (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [id, interaction.user.id]);
  if (!ins.rowCount) return interaction.reply({ content: 'Už v partě jsi.', flags: EPHEMERAL });

  checkAchievements(interaction.client, interaction.guildId, interaction.user.id);
  let members = await getMembers(id);
  if (members.length > post.capacity) {
    await query('DELETE FROM lfg_members WHERE post_id = $1 AND user_id = $2', [id, interaction.user.id]);
    return interaction.reply({ content: 'Parta je mezitím plná.', flags: EPHEMERAL });
  }

  if (members.length < post.capacity) {
    return interaction.update(buildPost(post, members));
  }

  // Parta je plná: označit příspěvek, vytvořit voice a upozornit hráče.
  const { rows: [full] } = await query(`UPDATE lfg_posts SET status = 'full' WHERE id = $1 AND status = 'open' RETURNING *`, [id]);
  await interaction.update(buildPost(full, members));

  const voice = await createVoice(interaction.guild, full).catch((e) => { console.error(e); return null; });
  if (voice) {
    await query('UPDATE lfg_posts SET voice_channel_id = $1, voice_empty_since = now() WHERE id = $2', [voice.id, id]);
    full.voice_channel_id = voice.id;
    await interaction.message.edit(buildPost(full, members));
  }
  // Při velkých partách se pingy rozdělí do více zpráv, protože jedna zpráva má limit na délku.
  const ids = members.map((m) => m.user_id);
  const groups = Array.from({ length: Math.ceil(ids.length / MENTIONS_PER_MESSAGE) }, (_, i) => ids.slice(i * MENTIONS_PER_MESSAGE, (i + 1) * MENTIONS_PER_MESSAGE));
  for (const [i, group] of groups.entries()) {
    const payload = {
      content: `${i === 0 ? 'Parta je kompletní! ' : ''}${group.map((u) => `<@${u}>`).join(' ')}${i === 0 && voice ? `\nSejdeme se ve voice: ${voice}` : ''}`,
      allowedMentions: { users: group },
    };
    if (i === 0) await interaction.message.reply(payload);
    else await interaction.channel.send(payload);
  }
}

async function createVoice(guild, post) {
  const settings = await getSettings(guild.id);
  const lfgChannel = await guild.channels.fetch(settings.lfgChannel).catch(() => null);
  return guild.channels.create({
    name: `LFG · ${post.game_name.slice(0, 60)} #${post.id}`,
    type: ChannelType.GuildVoice,
    parent: settings.lfgCategory ?? lfgChannel?.parentId ?? null,
    userLimit: post.capacity,
    reason: 'LFG parta je kompletní',
  });
}

async function leave(interaction, id) {
  const post = await getPost(id);
  if (!post || post.status !== 'open') return inactive(interaction);
  if (post.founder_id === interaction.user.id) {
    return interaction.reply({ content: 'Jako zakladatel můžeš hledání jen zavřít tlačítkem Zavřít.', flags: EPHEMERAL });
  }
  const del = await query('DELETE FROM lfg_members WHERE post_id = $1 AND user_id = $2', [id, interaction.user.id]);
  if (!del.rowCount) return interaction.reply({ content: 'V partě nejsi.', flags: EPHEMERAL });
  await interaction.update(buildPost(post, await getMembers(id)));
}

async function players(interaction, id) {
  const post = await getPost(id);
  if (!post) return inactive(interaction);
  const members = await getMembers(id);
  const header = `**Hráči v partě (${members.length}/${post.capacity})**\n`;
  const lines = members.map((m, i) => `${i + 1}. <@${m.user_id}>${m.user_id === post.founder_id ? ' (zakladatel)' : ''}`);
  // Zpráva smí mít max. 2000 znaků, u velkých part zbytek zkrátíme.
  let body = '';
  let shown = 0;
  for (const line of lines) {
    if (header.length + body.length + line.length + 40 > 2000) break;
    body += `${line}\n`;
    shown++;
  }
  const rest = lines.length - shown;
  await interaction.reply({ content: `${header}${body}${rest > 0 ? `…a dalších ${rest}` : ''}`.trimEnd(), flags: EPHEMERAL });
}

async function close(interaction, id) {
  const post = await getPost(id);
  if (!post || post.status !== 'open') return inactive(interaction);
  const settings = await getSettings(interaction.guildId);
  const allowed =
    post.founder_id === interaction.user.id ||
    interaction.memberPermissions?.has(P.Administrator) ||
    (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));
  if (!allowed) return interaction.reply({ content: 'Hledání může zavřít jen zakladatel nebo tým.', flags: EPHEMERAL });

  const { rows: [closed] } = await query(`UPDATE lfg_posts SET status = 'closed' WHERE id = $1 RETURNING *`, [id]);
  await interaction.update(buildPost(closed, await getMembers(id)));
}

/* ---------- Úklid na pozadí (vypršení a mazání voice) ---------- */

async function sweep(client) {
  // Příspěvky starší než 24 hodin vyprší.
  const { rows: expired } = await query(
    `UPDATE lfg_posts SET status = 'expired' WHERE status = 'open' AND created_at < now() - ($1 || ' hours')::interval RETURNING *`,
    [String(EXPIRE_HOURS)],
  );
  for (const post of expired) {
    try {
      const channel = await client.channels.fetch(post.channel_id).catch(() => null);
      const message = await channel?.messages.fetch(post.message_id).catch(() => null);
      await message?.edit(buildPost(post, await getMembers(post.id)));
    } catch (err) { console.error(err); }
  }

  // Dočasné voice roomky: smazat, když jsou delší dobu prázdné.
  const { rows: voices } = await query('SELECT * FROM lfg_posts WHERE voice_channel_id IS NOT NULL');
  for (const post of voices) {
    try {
      const channel = await client.channels.fetch(post.voice_channel_id).catch(() => null);
      if (!channel) {
        await query('UPDATE lfg_posts SET voice_channel_id = NULL WHERE id = $1', [post.id]);
        continue;
      }
      if (channel.members.size > 0) {
        if (post.voice_empty_since) await query('UPDATE lfg_posts SET voice_empty_since = NULL WHERE id = $1', [post.id]);
        continue;
      }
      if (!post.voice_empty_since) {
        await query('UPDATE lfg_posts SET voice_empty_since = now() WHERE id = $1', [post.id]);
      } else if (Date.now() - new Date(post.voice_empty_since).getTime() > VOICE_EMPTY_MINUTES * 60_000) {
        await channel.delete('LFG voice roomka je prázdná');
        await query('UPDATE lfg_posts SET voice_channel_id = NULL, voice_empty_since = NULL WHERE id = $1', [post.id]);
      }
    } catch (err) { console.error(err); }
  }
}

export function startLfgSweeper(client) {
  const run = () => sweep(client).catch(console.error);
  run();
  setInterval(run, 60_000);
}
