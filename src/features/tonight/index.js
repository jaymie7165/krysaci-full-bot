import {
  ActionRowBuilder, MessageFlags, PermissionFlagsBits as P, StringSelectMenuBuilder, ButtonStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { addHeader, button, divider, newPanel, text, asMessage } from '../../ui.js';
import { checkAchievements } from '../achievements/index.js';
import { buildPost } from '../lfg/ui.js';
import { GAMES, gameById } from '../roles/data.js';
import { buildBoard, refreshBoard, scheduleBoardUpdate } from './board.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const THRESHOLD = 3;           // kolik lidí musí říct "jdu", aby z toho vznikla parta
const EXPIRE_HOURS = 3;        // "Hrajeme?" je spontánní, po 3 hodinách vyprší
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

/* ---------- Karta "Hrajeme?" ---------- */

const getAsk = async (id) => (await query('SELECT * FROM hrajeme WHERE id = $1', [id])).rows[0];
const getVotes = async (id) => (await query('SELECT * FROM hrajeme_votes WHERE hrajeme_id = $1 ORDER BY user_id', [id])).rows;

export function buildAsk(h, votes) {
  const yes = votes.filter((v) => v.vote === 'yes');
  const maybe = votes.filter((v) => v.vote === 'maybe');
  const names = (list) => (list.length ? `${list.slice(0, 25).map((v) => `<@${v.user_id}>`).join(' ')}${list.length > 25 ? ` a dalších ${list.length - 25}` : ''}` : '—');
  const titles = {
    open: `### 🙋 Hrajeme ${h.game_id === 'any' ? 'něco' : h.game_name}?`,
    converted: `### 🎉 Parta vznikla · ${h.game_name}`,
    closed: `### 🔒 Uzavřeno · ${h.game_name}`,
    expired: `### ⌛ Vypršelo · ${h.game_name}`,
  };
  const color = { open: colors.accent, converted: colors.success, closed: colors.neutral, expired: colors.neutral }[h.status];
  const container = newPanel(color)
    .addTextDisplayComponents(text(`${titles[h.status]}\n-# Ptá se <@${h.creator_id}>${h.status === 'open' ? ` · potřebujeme aspoň ${THRESHOLD} lidi` : ''}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`✅ **Jdu** (${yes.length})  ${names(yes)}\n🤔 **Možná** (${maybe.length})  ${names(maybe)}`));
  if (h.status === 'converted' && h.party_url) container.addTextDisplayComponents(text(`🎮 [Otevřít hledání party](${h.party_url})`));
  if (h.status === 'open') {
    container.addSeparatorComponents(divider()).addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`hr:yes:${h.id}`, '✅ Jdu', ButtonStyle.Success),
        button(`hr:maybe:${h.id}`, '🤔 Možná'),
        button(`hr:no:${h.id}`, '❌ Nejdu'),
        button(`hr:close:${h.id}`, '🔒 Zavřít'),
      ),
    );
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/* ---------- Obsluha ---------- */

export async function handleTonightInteraction(interaction) {
  const [prefix, action, arg] = interaction.customId.split(':');
  if (prefix === 'hr') return vote(interaction, action, Number(arg));
  if (action === 'refresh') {
    await interaction.deferUpdate();
    return refreshBoard(interaction.client, interaction.guildId, { force: true });
  }
  if (action === 'ask') return askStart(interaction);
  if (action === 'askpick') return askCreate(interaction);
}

async function askStart(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!settings.tonightChannel) return interaction.reply({ content: 'Přehled Dnes večer ještě není nastavený. Napiš prosím správci serveru.', flags: EPHEMERAL });
  const { rows } = await query(`SELECT * FROM hrajeme WHERE guild_id = $1 AND creator_id = $2 AND status = 'open'`, [interaction.guildId, interaction.user.id]);
  if (rows.length) {
    return interaction.reply({ content: `Už máš otevřené „Hrajeme?“: https://discord.com/channels/${rows[0].guild_id}/${rows[0].channel_id}/${rows[0].message_id}\nNejdřív ho zavři, nebo počkej, až vyprší.`, flags: EPHEMERAL });
  }
  const menu = new StringSelectMenuBuilder().setCustomId('tonight:askpick').setPlaceholder('Co by sis zahrál?').addOptions([
    ...GAMES.map((g) => ({ label: g.name, value: g.id })),
    { label: 'Cokoli, domluvíme se', value: 'any' },
  ]);
  await interaction.reply({ content: 'Na co se chceš zeptat ostatních? Zveřejním otázku a kdo bude chtít, dá vědět. Když se sejde aspoň 3 lidí, bot z toho udělá partu.', components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
}

async function askCreate(interaction) {
  const settings = await getSettings(interaction.guildId);
  const channel = settings.tonightChannel ? await interaction.guild.channels.fetch(settings.tonightChannel).catch(() => null) : null;
  if (!channel) return interaction.update({ content: 'Kanál pro přehled se nepodařilo najít. Napiš prosím správci serveru.', components: [] });
  const gameId = interaction.values[0];
  const gameName = gameId === 'any' ? 'Cokoli' : gameById(gameId).name;

  const { rows: open } = await query(`SELECT 1 FROM hrajeme WHERE guild_id = $1 AND creator_id = $2 AND status = 'open'`, [interaction.guildId, interaction.user.id]);
  if (open.length) return interaction.update({ content: 'Už máš otevřené „Hrajeme?“.', components: [] });

  const { rows: [h] } = await query('INSERT INTO hrajeme (guild_id, channel_id, creator_id, game_id, game_name) VALUES ($1, $2, $3, $4, $5) RETURNING *', [interaction.guildId, channel.id, interaction.user.id, gameId, gameName]);
  await query(`INSERT INTO hrajeme_votes (hrajeme_id, user_id, vote) VALUES ($1, $2, 'yes')`, [h.id, interaction.user.id]);
  try {
    const message = await channel.send(buildAsk(h, await getVotes(h.id)));
    await query('UPDATE hrajeme SET message_id = $1 WHERE id = $2', [message.id, h.id]);
    await interaction.update({ content: `Hotovo, otázka je zveřejněná: ${message.url}`, components: [] });
    scheduleBoardUpdate(interaction.client, interaction.guildId, 1000);
  } catch (err) {
    await query('DELETE FROM hrajeme WHERE id = $1', [h.id]);
    throw err;
  }
}

async function vote(interaction, action, id) {
  const h = await getAsk(id);
  if (!h || h.status !== 'open') return interaction.reply({ content: 'Toto „Hrajeme?“ už není aktivní.', flags: EPHEMERAL });

  if (action === 'close') {
    const settings = await getSettings(interaction.guildId);
    const staff = interaction.memberPermissions?.has(P.Administrator) || (settings.staffRole && interaction.member?.roles?.cache?.has(settings.staffRole));
    if (interaction.user.id !== h.creator_id && !staff) return interaction.reply({ content: 'Zavřít to může jen ten, kdo se ptal, nebo tým.', flags: EPHEMERAL });
    const { rows: [closed] } = await query(`UPDATE hrajeme SET status = 'closed' WHERE id = $1 RETURNING *`, [id]);
    await interaction.update(buildAsk(closed, await getVotes(id)));
    return scheduleBoardUpdate(interaction.client, interaction.guildId, 1000);
  }

  if (action === 'no') await query('DELETE FROM hrajeme_votes WHERE hrajeme_id = $1 AND user_id = $2', [id, interaction.user.id]);
  else await query(`INSERT INTO hrajeme_votes (hrajeme_id, user_id, vote) VALUES ($1, $2, $3) ON CONFLICT (hrajeme_id, user_id) DO UPDATE SET vote = $3`, [id, interaction.user.id, action]);

  const votes = await getVotes(id);
  const yes = votes.filter((v) => v.vote === 'yes').map((v) => v.user_id);
  if (action === 'yes' && yes.length >= THRESHOLD) {
    await interaction.deferUpdate();
    const result = await convertToParty(interaction.client, interaction.guild, h, yes);
    if (result.ok) return; // karta už je upravená na "Parta vznikla"
    await interaction.editReply(buildAsk(h, votes));
    return interaction.followUp({ content: result.reason, flags: EPHEMERAL });
  }
  await interaction.update(buildAsk(h, votes));
  scheduleBoardUpdate(interaction.client, interaction.guildId, 3000);
}

/* ---------- Z "Hrajeme?" se stane parta v LFG ---------- */

async function convertToParty(client, guild, h, memberIds) {
  const settings = await getSettings(h.guild_id);
  const lfgChannel = await client.channels.fetch(settings.lfgChannel ?? h.channel_id).catch(() => null);
  if (!lfgChannel) return { ok: false, reason: 'Kanál pro hledání se nepodařilo najít, parta zatím nevznikla.' };
  const { rows: existing } = await query(`SELECT 1 FROM lfg_posts WHERE guild_id = $1 AND founder_id = $2 AND status = 'open'`, [h.guild_id, h.creator_id]);
  if (existing.length) return { ok: false, reason: 'Zakladatel už má jiné aktivní hledání, parta zatím nevznikla. Ať ho nejdřív zavře.' };

  const game = gameById(h.game_id);
  const capacity = Math.max(game?.size ?? 5, memberIds.length + 1);
  const founder = await guild.members.fetch(h.creator_id).catch(() => null);
  const { rows: [post] } = await query(
    `INSERT INTO lfg_posts (guild_id, channel_id, founder_id, game_id, game_name, capacity, time_text, vibe_text, founder_avatar)
     VALUES ($1, $2, $3, $4, $5, $6, 'Teď', 'Vzniklo z „Hrajeme?“', $7) RETURNING *`,
    [h.guild_id, lfgChannel.id, h.creator_id, h.game_id === 'any' ? 'other' : h.game_id, h.game_id === 'any' ? 'Hraní (domluvíme se)' : h.game_name, capacity, founder?.displayAvatarURL?.({ size: 128 }) ?? null],
  );
  for (const id of memberIds) await query('INSERT INTO lfg_members (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [post.id, id]);

  const roleId = h.game_id === 'any' ? null : settings.roleMap?.[`game:${h.game_id}`];
  const members = (await query('SELECT * FROM lfg_members WHERE post_id = $1 ORDER BY joined_at', [post.id])).rows;
  const partyMessage = await lfgChannel.send({
    ...buildPost(post, members, { ping: roleId ? `<@&${roleId}>` : undefined }),
    allowedMentions: { roles: roleId ? [roleId] : [] },
  });
  await query('UPDATE lfg_posts SET message_id = $1 WHERE id = $2', [partyMessage.id, post.id]);

  const partyUrl = `https://discord.com/channels/${h.guild_id}/${lfgChannel.id}/${partyMessage.id}`;
  const { rows: [done] } = await query(`UPDATE hrajeme SET status = 'converted', lfg_post_id = $2 WHERE id = $1 RETURNING *`, [h.id, post.id]);
  done.party_url = partyUrl;

  // Karta "Hrajeme?" se změní na odkaz na partu a zúčastnění dostanou upozornění.
  const askChannel = await client.channels.fetch(h.channel_id).catch(() => null);
  const askMessage = await askChannel?.messages.fetch(h.message_id).catch(() => null);
  await askMessage?.edit(buildAsk(done, await getVotes(h.id)));
  await askChannel?.send({
    content: `🎉 **Parta vznikla!** ${memberIds.map((u) => `<@${u}>`).join(' ')}\n${partyUrl}`,
    allowedMentions: { users: memberIds },
  }).catch(() => {});
  for (const id of memberIds) checkAchievements(client, h.guild_id, id);
  scheduleBoardUpdate(client, h.guild_id, 1000);
  return { ok: true, partyUrl };
}

/* ---------- Vypršení ---------- */

export function startHrajemeSweeper(client) {
  const run = async () => {
    const { rows } = await query(`UPDATE hrajeme SET status = 'expired' WHERE status = 'open' AND created_at < now() - ($1 || ' hours')::interval RETURNING *`, [String(EXPIRE_HOURS)]);
    for (const h of rows) {
      try {
        const channel = await client.channels.fetch(h.channel_id).catch(() => null);
        const message = await channel?.messages.fetch(h.message_id).catch(() => null);
        await message?.edit(buildAsk(h, await getVotes(h.id)));
        scheduleBoardUpdate(client, h.guild_id, 1000);
      } catch (err) { console.error(err); }
    }
  };
  run().catch(console.error);
  setInterval(() => run().catch(console.error), 60_000);
}

// Pro /nastaveni dnesvecer: první vykreslení přehledu.
export { buildBoard };
