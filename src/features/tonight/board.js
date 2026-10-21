import { createHash } from 'node:crypto';
import { ActionRowBuilder, ButtonStyle } from 'discord.js';
import { getSettings, query } from '../../db.js';
import { addFooter, addHeader, asMessage, button, divider, newPanel, panelIcon, text } from '../../ui.js';

const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const url = (guildId, channelId, messageId) => (channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null);
const link = (label, u) => (u ? ` · [${label}](${u})` : '');
const fill = (n, cap) => (cap ? `${n}/${cap}` : `${n} lidí`);

// Údaje pro přehled: otevřené party, události v příštích 24 hodinách, aktivní voice a otevřené "Hrajeme?".
async function gather(guild) {
  const g = guild.id;
  const { rows: parties } = await query(
    `SELECT p.*, (SELECT count(*)::int FROM lfg_members m WHERE m.post_id = p.id) AS n FROM lfg_posts p
     WHERE p.guild_id = $1 AND p.status = 'open' ORDER BY p.created_at DESC LIMIT 5`, [g]);
  const { rows: events } = await query(
    `SELECT e.*, (SELECT count(*)::int FROM event_signups s WHERE s.event_id = e.id) AS n FROM events e
     WHERE e.guild_id = $1 AND e.status = 'open' AND e.starts_at > now() AND e.starts_at < now() + interval '24 hours'
     ORDER BY e.starts_at LIMIT 4`, [g]);
  const { rows: asks } = await query(
    `SELECT h.*, (SELECT count(*)::int FROM hrajeme_votes v WHERE v.hrajeme_id = h.id AND v.vote = 'yes') AS yes,
            (SELECT count(*)::int FROM hrajeme_votes v WHERE v.hrajeme_id = h.id AND v.vote = 'maybe') AS maybe
     FROM hrajeme h WHERE h.guild_id = $1 AND h.status = 'open' ORDER BY h.created_at DESC LIMIT 4`, [g]);
  const voices = [...guild.channels.cache.values()]
    .filter((c) => c.isVoiceBased?.())
    .map((c) => ({ c, humans: [...c.members.values()].filter((m) => !m.user.bot) }))
    .filter((x) => x.humans.length)
    .sort((a, b) => b.humans.length - a.humans.length)
    .slice(0, 6);
  return { parties, events, asks, voices };
}

export async function buildBoard(guild, client) {
  const { parties, events, asks, voices } = await gather(guild);
  const sections = [];

  if (parties.length) {
    sections.push(`### 🔎 Otevřené party\n${parties.map((p) =>
      `${p.game_id === 'chat' ? '💬' : '🎮'} **${p.game_name}** · ${fill(p.n, p.capacity)} · ${p.time_text || 'co nejdřív'}${link('otevřít', url(p.guild_id, p.channel_id, p.message_id))}`).join('\n')}`);
  }
  if (asks.length) {
    sections.push(`### 🙋 Hrajeme?\n${asks.map((h) =>
      `**${h.game_name}** · ${h.yes} jde${h.maybe ? `, ${h.maybe} možná` : ''}${link('přidat se', url(h.guild_id, h.channel_id, h.message_id))}`).join('\n')}`);
  }
  if (events.length) {
    sections.push(`### 📅 Dnes a zítra\n${events.map((e) =>
      `**${e.title}** · <t:${unix(e.starts_at)}:t> (<t:${unix(e.starts_at)}:R>) · ${e.n}${e.capacity ? `/${e.capacity}` : ''} přihlášených${link('přihlásit se', url(e.guild_id, e.channel_id, e.message_id))}`).join('\n')}`);
  }
  if (voices.length) {
    sections.push(`### 🔊 Ve voice teď\n${voices.map(({ c, humans }) =>
      `<#${c.id}> · ${humans.length}${humans.length <= 4 ? ` · ${humans.map((m) => `<@${m.id}>`).join(' ')}` : ''}`).join('\n')}`);
  }

  const container = newPanel();
  addHeader(container, '## 🌙 Dnes večer\nCo se právě děje na serveru. Tuto zprávu bot průběžně upravuje.', panelIcon(guild, client));
  container.addSeparatorComponents(divider());
  if (sections.length) {
    sections.forEach((s, i) => {
      if (i) container.addSeparatorComponents(divider());
      container.addTextDisplayComponents(text(s.slice(0, 1500)));
    });
  } else {
    container.addTextDisplayComponents(text('Zatím je ticho. Buď první: klikni na **Hrajeme?** nebo založ hledání.'));
  }
  container.addSeparatorComponents(divider()).addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button('tonight:ask', '🙋 Hrajeme?', ButtonStyle.Primary),
      button('lfg:new', '🔎 Založit hledání'),
      button('tonight:refresh', '🔄 Obnovit'),
    ),
  );
  addFooter(container, 'Aktualizuje se samo. Kdo se na něco přihlásí, uvidí to tu do pár sekund.');
  return { ...asMessage(container), allowedMentions: { parse: [] } };
}

/* ---------- Aktualizace zprávy ---------- */

const hashes = new Map();
const timers = new Map();

// Upraví přehled, jen když se obsah opravdu změnil (šetří úpravy zpráv).
export async function refreshBoard(client, guildId, { force = false } = {}) {
  const settings = await getSettings(guildId);
  const ref = settings.panels?.tonight;
  const guild = client.guilds?.cache?.get(guildId);
  if (!ref || !guild) return false;
  const payload = await buildBoard(guild, client);
  const hash = createHash('md5').update(JSON.stringify(payload.components.map((c) => c.toJSON()))).digest('hex');
  if (!force && hashes.get(guildId) === hash) return false;
  const channel = await client.channels.fetch(ref.channel).catch(() => null);
  const message = await channel?.messages.fetch(ref.message).catch(() => null);
  if (!message) return false;
  await message.edit(payload);
  hashes.set(guildId, hash);
  return true;
}

// Spojí víc změn za sebou do jedné aktualizace.
export function scheduleBoardUpdate(client, guildId, delay = 5000) {
  clearTimeout(timers.get(guildId));
  timers.set(guildId, setTimeout(() => refreshBoard(client, guildId).catch((e) => console.error('Přehled Dnes večer:', e.message)), delay));
}

export function startBoardUpdater(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await refreshBoard(client, guild.id).catch((e) => console.error('Přehled Dnes večer:', e.message));
  };
  setInterval(run, 120_000);
}
