import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { hasKick, hasTwitch, kickChannel, kickLive, twitchLive, twitchUser } from './api.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const POLL_MS = 60_000;
const OFFLINE_POLLS_TO_END = 3;       // 3 minuty offline, než stream považujeme za ukončený
const RECONNECT_WINDOW_MS = 20 * 60_000; // výpadek do 20 minut není nový stream
const PLATFORM = {
  twitch: { name: 'Twitch', color: 0x9146ff, watch: 'Sledovat na Twitchi', home: (l) => `https://twitch.tv/${l}` },
  kick: { name: 'Kick', color: 0x53fc18, watch: 'Sledovat na Kicku', home: (l) => `https://kick.com/${l}` },
};

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const link = (label, url) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);

function duration(from, to = Date.now()) {
  const minutes = Math.max(0, Math.round((to - new Date(from).getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  return h ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

// Karta oznámení. `live` obsahuje aktuální údaje ze streamu, bez něj se vykreslí ukončený stream.
export function buildStreamCard(streamer, live, { ping } = {}) {
  const p = PLATFORM[streamer.platform];
  const who = streamer.discord_user_id ? `**${streamer.display_name}** (<@${streamer.discord_user_id}>)` : `**${streamer.display_name}**`;
  const container = new ContainerBuilder();

  if (live) {
    const head = text(
      `### ${streamer.display_name} právě streamuje\n**${live.title || 'Bez názvu'}**\n` +
      `${live.game ? `${live.game} · ` : ''}${live.viewers} diváků\n-# ${p.name}`,
    );
    container.setAccentColor(p.color);
    const avatar = streamer.avatar_url || live.avatar;
    if (avatar) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(head).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
    else container.addTextDisplayComponents(head);
    if (live.thumbnail) {
      const url = `${live.thumbnail}${live.thumbnail.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 300_000)}`;
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)));
    }
    container.addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(link(p.watch, live.url)));
  } else {
    container.setAccentColor(colors.neutral).addTextDisplayComponents(text(
      `### ${streamer.display_name} už nestreamuje\n${streamer.last_title ? `**${streamer.last_title}**\n` : ''}` +
      `-# ${p.name}${streamer.started_at ? ` · stream trval ${duration(streamer.started_at)}` : ''}`,
    ));
    container.addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(link('Kanál', p.home(streamer.login))));
  }
  const components = ping ? [text(ping), container] : [container];
  return { components, flags: MessageFlags.IsComponentsV2, _who: who };
}

/* ---------- Hlídání streamů ---------- */

async function fetchLive(rows) {
  const result = { twitch: null, kick: null };
  const twitch = rows.filter((r) => r.platform === 'twitch');
  const kick = rows.filter((r) => r.platform === 'kick');
  // Při chybě API necháme hodnotu null, aby se stream omylem neoznačil jako ukončený.
  if (twitch.length && hasTwitch()) result.twitch = await twitchLive(twitch.map((r) => r.login)).catch((e) => { console.error('Twitch:', e.message); return null; });
  if (kick.length && hasKick()) result.kick = await kickLive(kick.map((r) => r.platform_id)).catch((e) => { console.error('Kick:', e.message); return null; });
  return result;
}

async function announce(client, streamer, live) {
  const settings = await getSettings(streamer.guild_id);
  const channel = settings.streamChannel ? await client.channels.fetch(settings.streamChannel).catch(() => null) : null;
  if (!channel) return;
  const ping = settings.streamRole ? `<@&${settings.streamRole}>` : undefined;
  const { _who, ...card } = buildStreamCard(streamer, live, { ping });
  const message = await channel.send({ ...card, allowedMentions: { roles: settings.streamRole ? [settings.streamRole] : [] } });
  await query(
    `UPDATE streamers SET is_live = true, session_key = $2, channel_id = $3, message_id = $4, announced_at = now(), started_at = $5, last_title = $6, offline_polls = 0 WHERE id = $1`,
    [streamer.id, live.sessionKey, channel.id, message.id, live.startedAt ?? new Date(), live.title],
  );
}

async function editCard(client, streamer, live) {
  const channel = await client.channels.fetch(streamer.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(streamer.message_id).catch(() => null);
  if (!message) return false;
  const { _who, ...card } = buildStreamCard(streamer, live);
  await message.edit(card);
  return true;
}

async function handle(client, streamer, live) {
  if (live) {
    if (streamer.is_live) {
      if (streamer.session_key !== live.sessionKey || streamer.offline_polls) {
        await query('UPDATE streamers SET session_key = $2, offline_polls = 0 WHERE id = $1', [streamer.id, live.sessionKey]);
      }
      return;
    }
    // Přechod na live. Krátký výpadek nebo reconnect nepovažujeme za nový stream.
    const recent = streamer.announced_at && Date.now() - new Date(streamer.announced_at).getTime() < RECONNECT_WINDOW_MS;
    if (streamer.message_id && (recent || streamer.session_key === live.sessionKey)) {
      const updated = { ...streamer, started_at: streamer.started_at ?? live.startedAt };
      if (await editCard(client, updated, live)) {
        await query('UPDATE streamers SET is_live = true, session_key = $2, offline_polls = 0, last_title = $3 WHERE id = $1', [streamer.id, live.sessionKey, live.title]);
        return;
      }
    }
    return announce(client, streamer, live);
  }

  if (!streamer.is_live) return;
  const polls = streamer.offline_polls + 1;
  if (polls < OFFLINE_POLLS_TO_END) {
    await query('UPDATE streamers SET offline_polls = $2 WHERE id = $1', [streamer.id, polls]);
    return;
  }
  await editCard(client, streamer, null).catch((e) => console.error('Ukončení karty streamu:', e.message));
  await query('UPDATE streamers SET is_live = false, offline_polls = 0 WHERE id = $1', [streamer.id]);
}

export async function pollStreams(client) {
  const { rows } = await query('SELECT * FROM streamers');
  if (!rows.length) return;
  const live = await fetchLive(rows);
  for (const streamer of rows) {
    const map = live[streamer.platform];
    if (!map) continue; // platforma nemá klíč nebo API selhalo
    const key = streamer.platform === 'twitch' ? streamer.login : streamer.platform_id;
    try {
      await handle(client, streamer, map.get(key) ?? null);
    } catch (err) { console.error('Stream:', err); }
  }
}

export function startStreamPoller(client) {
  const run = () => pollStreams(client).catch(console.error);
  run();
  setInterval(run, POLL_MS);
}

/* ---------- Příkaz /stream ---------- */

export async function handleStreamCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'seznam') return list(interaction);
  if (sub === 'pridat') return add(interaction);
  if (sub === 'odebrat') return remove(interaction);
}

async function add(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const platform = interaction.options.getString('platforma', true);
  const raw = interaction.options.getString('kanal', true).trim().replace(/^https?:\/\/(www\.)?(twitch\.tv|kick\.com)\//i, '').replace(/\/.*$/, '').replace(/^@/, '');
  const member = interaction.options.getUser('clen');

  if (platform === 'twitch' && !hasTwitch()) return interaction.editReply('Twitch není nastavený (chybí TWITCH_CLIENT_ID a TWITCH_CLIENT_SECRET na Railway).');
  if (platform === 'kick' && !hasKick()) return interaction.editReply('Kick není nastavený (chybí KICK_CLIENT_ID a KICK_CLIENT_SECRET na Railway).');

  let info;
  try {
    info = platform === 'twitch' ? await twitchUser(raw.toLowerCase()) : await kickChannel(raw.toLowerCase());
  } catch (err) {
    console.error(err);
    return interaction.editReply('Nepodařilo se spojit s platformou. Zkontroluj přístupové údaje a zkus to znovu.');
  }
  if (!info) return interaction.editReply(`Kanál **${raw}** jsem na ${PLATFORM[platform].name} nenašel.`);

  const ins = await query(
    `INSERT INTO streamers (guild_id, platform, login, platform_id, display_name, avatar_url, discord_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (guild_id, platform, login) DO NOTHING RETURNING id`,
    [interaction.guildId, platform, info.login.toLowerCase(), info.platformId, info.displayName, info.avatar, member?.id ?? null],
  );
  if (!ins.rowCount) return interaction.editReply('Tento kanál už je v seznamu.');
  const settings = await getSettings(interaction.guildId);
  await interaction.editReply(
    `Přidáno: **${info.displayName}** (${PLATFORM[platform].name}). Pokud už streamuje, oznámení přijde do minuty.` +
    (settings.streamChannel ? '' : '\nPozor: ještě nemáš nastavený kanál pro oznámení. Použij /nastaveni stream.'),
  );
}

async function remove(interaction) {
  const platform = interaction.options.getString('platforma', true);
  const login = interaction.options.getString('kanal', true).trim().toLowerCase().replace(/^@/, '');
  const del = await query('DELETE FROM streamers WHERE guild_id = $1 AND platform = $2 AND login = $3', [interaction.guildId, platform, login]);
  await interaction.reply({ content: del.rowCount ? 'Streamer je odebraný.' : 'Tento kanál v seznamu není.', flags: EPHEMERAL });
}

async function list(interaction) {
  const { rows } = await query('SELECT * FROM streamers WHERE guild_id = $1 ORDER BY platform, login', [interaction.guildId]);
  const lines = rows.map((r) => `${PLATFORM[r.platform].name} · **${r.display_name}**${r.is_live ? ' · právě live' : ''}${r.discord_user_id ? ` · <@${r.discord_user_id}>` : ''}`);
  await interaction.reply({ content: lines.length ? `**Sledovaní streameři**\n${lines.join('\n')}` : 'Zatím nesleduješ žádného streamera. Přidej ho příkazem /stream pridat.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
}
