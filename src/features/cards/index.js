import {
  ActionRowBuilder, ButtonStyle, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  escapeMarkdown,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { addFooter, addHeader, addRow, asMessage, button, divider, newPanel, text } from '../../ui.js';
import { GAMES, RANKS } from '../roles/data.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const HELLO_COOLDOWN_H = 24;

export const STYLES = [
  { value: 'casual', label: 'Casual: hraju v klidu', short: 'Casual' },
  { value: 'comp', label: 'Kompetitivní: hraju naostro', short: 'Kompetitivní' },
  { value: 'both', label: 'Obojí podle nálady', short: 'Obojí podle nálady' },
];
export const TIMES = [
  { value: 'morning', label: 'Dopoledne' }, { value: 'afternoon', label: 'Odpoledne' }, { value: 'evening', label: 'Večer' },
  { value: 'night', label: 'Noc' }, { value: 'weekend', label: 'Víkendy' },
];
export const OPEN = [
  { value: 'new', label: 'Rád poznám nové lidi' }, { value: 'group', label: 'Spíš hraju se stálou partou' }, { value: 'mood', label: 'Podle nálady' },
];
const labelOf = (list, value) => list.find((x) => x.value === value)?.label;

/* ---------- Data ---------- */

export const getCard = async (guildId, userId) => (await query('SELECT * FROM member_cards WHERE guild_id = $1 AND user_id = $2', [guildId, userId])).rows[0];

const COLUMNS = { style: 'style', times: 'times', open_to: 'open_to', about: 'about' };
async function saveCard(guildId, userId, column, value) {
  if (!COLUMNS[column]) throw new Error('neplatný sloupec');
  await query('INSERT INTO member_cards (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, userId]);
  await query(`UPDATE member_cards SET ${COLUMNS[column]} = $3, updated_at = now() WHERE guild_id = $1 AND user_id = $2`, [guildId, userId, value]);
}

// Hry a ranky člena podle jeho rolí.
function gamesOf(member, roleMap = {}) {
  const has = (key) => roleMap[key] && member.roles.cache.has(roleMap[key]);
  const games = GAMES.filter((g) => has(`game:${g.id}`));
  const ranks = Object.keys(RANKS).flatMap((gameId) => {
    const idx = RANKS[gameId].findIndex((_, i) => has(`rank:${gameId}:${i}`));
    const game = GAMES.find((g) => g.id === gameId);
    return idx >= 0 ? [`${game.short} · ${RANKS[gameId][idx]}`] : [];
  });
  return { games, ranks };
}

/* ---------- Panel ---------- */

export function buildCardsPanel({ iconUrl } = {}) {
  const container = newPanel();
  addHeader(container, '## 🤝 Get2know\nPředstav se ostatním a najdi lidi, se kterými si sedneš. Všechno je dobrovolné a pod tvou kontrolou.', iconUrl);
  container.addSeparatorComponents(divider());
  addRow(container, { emoji: '🪪', label: 'Moje vizitka', description: 'Pár otázek o tom, jak hraješ. Pak ji sám zveřejníš tady v kanálu.', button: button('card:edit', 'Vytvořit / upravit', ButtonStyle.Primary) });
  addRow(container, { emoji: '🔎', label: 'Najít spoluhráče', description: 'Ukážu ti lidi s podobnými hrami, otevřené party a nejbližší akce.', button: button('card:match', 'Najít') });
  addFooter(container, 'Nikoho nekontaktuju sám. Vizitku smažeš kdykoli a pozdrav ti pošle jen ten, kdo ji uvidí.');
  return asMessage(container);
}

/* ---------- Editor vizitky (jen pro autora) ---------- */

function editorPayload(card) {
  const style = new StringSelectMenuBuilder().setCustomId('card:style').setPlaceholder('Jak rád hraješ?')
    .addOptions(STYLES.map((o) => ({ label: o.label, value: o.value, default: card?.style === o.value })));
  const times = new StringSelectMenuBuilder().setCustomId('card:times').setPlaceholder('Kdy obvykle hraješ?').setMinValues(0).setMaxValues(TIMES.length)
    .addOptions(TIMES.map((o) => ({ label: o.label, value: o.value, default: (card?.times ?? []).includes(o.value) })));
  const open = new StringSelectMenuBuilder().setCustomId('card:open').setPlaceholder('Poznáváš nové lidi?')
    .addOptions(OPEN.map((o) => ({ label: o.label, value: o.value, default: card?.open_to === o.value })));
  const row = (c) => new ActionRowBuilder().addComponents(c);
  const published = card?.message_id ? ' Vizitka je zveřejněná, po změnách klikni na **Aktualizovat**.' : '';
  return {
    content:
      `**🪪 Tvoje vizitka**\nVyplň jen to, co chceš sdílet. Hry a ranky se vezmou z tvých rolí.${published}` +
      `${card?.about ? `\n\n**O mně:** ${card.about}` : ''}`,
    components: [
      row(style), row(times), row(open),
      new ActionRowBuilder().addComponents(
        button('card:about', 'O mně'),
        button('card:publish', card?.message_id ? 'Aktualizovat' : 'Zveřejnit', ButtonStyle.Success),
        ...(card?.message_id ? [button('card:delete', 'Smazat vizitku', ButtonStyle.Danger)] : []),
      ),
    ],
    flags: EPHEMERAL,
  };
}

/* ---------- Veřejná vizitka ---------- */

export function buildCard(member, card, roleMap, otherActivities = []) {
  const { games, ranks } = gamesOf(member, roleMap);
  const times = (card.times ?? []).map((v) => labelOf(TIMES, v)).filter(Boolean);
  const lines = [
    `🎮 **Hraje**  ${games.map((g) => g.name).join(', ') || '—'}`,
    ...(ranks.length ? [`🏅 **Ranky**  ${ranks.join(', ')}`] : []),
    ...(card.style ? [`🎯 **Styl**  ${labelOf(STYLES, card.style)}`] : []),
    ...(times.length ? [`🕗 **Kdy hraju**  ${times.join(', ')}`] : []),
    ...(card.open_to ? [`🤝 **Poznávání**  ${labelOf(OPEN, card.open_to)}`] : []),
    ...(otherActivities.length ? [`✨ **Další**  ${otherActivities.join(', ')}`] : []),
  ];
  const container = newPanel(colors.accent);
  addHeader(container, `### 🪪 ${escapeMarkdown(member.displayName)}\n-# <@${member.id}>`, member.displayAvatarURL({ size: 128 }));
  container.addSeparatorComponents(divider()).addTextDisplayComponents(text(lines.join('\n')));
  if (card.about) container.addTextDisplayComponents(text(`💬 **O mně**\n> ${card.about.replace(/\n/g, '\n> ')}`));
  if (card.open_to !== 'group') {
    container.addSeparatorComponents(divider()).addActionRowComponents(
      new ActionRowBuilder().addComponents(button(`card:hi:${member.id}`, '👋 Pozdravit', ButtonStyle.Primary)),
    );
  } else {
    container.addSeparatorComponents(divider()).addTextDisplayComponents(text('-# Hraje radši se stálou partou, takže tu není tlačítko na pozdrav.'));
  }
  return asMessage(container);
}

/* ---------- Obsluha ---------- */

export async function handleCardInteraction(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  switch (action) {
    case 'edit': return openEditor(interaction);
    case 'style': return setField(interaction, 'style', interaction.values[0]);
    case 'times': return setField(interaction, 'times', interaction.values);
    case 'open': return setField(interaction, 'open_to', interaction.values[0]);
    case 'about': return showAbout(interaction);
    case 'aboutmodal': return saveAbout(interaction);
    case 'publish': return publish(interaction);
    case 'delete': return remove(interaction);
    case 'hi': return hello(interaction, arg);
    case 'match': return match(interaction);
  }
}

async function openEditor(interaction) {
  const card = await getCard(interaction.guildId, interaction.user.id);
  await interaction.reply(editorPayload(card));
}

async function setField(interaction, column, value) {
  await saveCard(interaction.guildId, interaction.user.id, column, value);
  const { flags, ...payload } = editorPayload(await getCard(interaction.guildId, interaction.user.id));
  await interaction.update(payload);
}

function showAbout(interaction) {
  const input = new TextInputBuilder().setCustomId('about').setLabel('Pár slov o tobě (volitelné)').setStyle(TextInputStyle.Paragraph)
    .setRequired(false).setMaxLength(300).setPlaceholder('Čím se bavíš, co hraješ nejraději, co hledáš…');
  return interaction.showModal(new ModalBuilder().setCustomId('card:aboutmodal').setTitle('O mně').addComponents(new ActionRowBuilder().addComponents(input)));
}

async function saveAbout(interaction) {
  await saveCard(interaction.guildId, interaction.user.id, 'about', interaction.fields.getTextInputValue('about').trim());
  const payload = editorPayload(await getCard(interaction.guildId, interaction.user.id));
  if (interaction.isFromMessage?.()) {
    const { flags, ...rest } = payload;
    return interaction.update(rest);
  }
  return interaction.reply(payload);
}

async function publish(interaction) {
  const settings = await getSettings(interaction.guildId);
  const channel = settings.cardChannel ? await interaction.guild.channels.fetch(settings.cardChannel).catch(() => null) : null;
  if (!channel) return interaction.reply({ content: 'Kanál pro vizitky ještě není nastavený. Napiš prosím správci serveru.', flags: EPHEMERAL });
  await interaction.deferReply({ flags: EPHEMERAL });

  const card = await getCard(interaction.guildId, interaction.user.id);
  const { rows: [profile] } = await query('SELECT other_activities FROM profiles WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, interaction.user.id]);
  const payload = { ...buildCard(interaction.member, card, settings.roleMap, profile?.other_activities ?? []), allowedMentions: { parse: [] } };

  let message = null;
  if (card.message_id && card.channel_id === channel.id) message = await channel.messages.fetch(card.message_id).catch(() => null);
  if (message) await message.edit(payload);
  else {
    if (card.message_id && card.channel_id) {
      const old = await interaction.guild.channels.fetch(card.channel_id).catch(() => null);
      await old?.messages.delete(card.message_id).catch(() => {});
    }
    message = await channel.send(payload);
  }
  await query('UPDATE member_cards SET channel_id = $3, message_id = $4 WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, interaction.user.id, channel.id, message.id]);
  await interaction.editReply(`Vizitka je zveřejněná: ${message.url}`);
}

async function remove(interaction) {
  const card = await getCard(interaction.guildId, interaction.user.id);
  if (card?.channel_id && card?.message_id) {
    const channel = await interaction.guild.channels.fetch(card.channel_id).catch(() => null);
    await channel?.messages.delete(card.message_id).catch(() => {});
  }
  await query('DELETE FROM member_cards WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, interaction.user.id]);
  await interaction.update({ content: 'Vizitka je smazaná. Kdykoli ji můžeš vytvořit znovu.', components: [] });
}

// Pozdrav: veřejná odpověď pod vizitkou, jen jednou za 24 hodin mezi dvěma lidmi.
async function hello(interaction, ownerId) {
  if (interaction.user.id === ownerId) return interaction.reply({ content: 'To je tvoje vlastní vizitka.', flags: EPHEMERAL });
  const card = await getCard(interaction.guildId, ownerId);
  if (!card || card.open_to === 'group') return interaction.reply({ content: 'Tento člen teď přes vizitku oslovení nechce.', flags: EPHEMERAL });
  const { rows: [last] } = await query('SELECT created_at FROM card_hellos WHERE guild_id = $1 AND from_id = $2 AND to_id = $3', [interaction.guildId, interaction.user.id, ownerId]);
  if (last && Date.now() - new Date(last.created_at).getTime() < HELLO_COOLDOWN_H * 3600_000) {
    return interaction.reply({ content: 'Tomuto členovi jsi už dnes pozdrav poslal. Dej mu chvíli.', flags: EPHEMERAL });
  }
  await query(
    `INSERT INTO card_hellos (guild_id, from_id, to_id) VALUES ($1, $2, $3) ON CONFLICT (guild_id, from_id, to_id) DO UPDATE SET created_at = now()`,
    [interaction.guildId, interaction.user.id, ownerId],
  );
  await interaction.message.reply({ content: `👋 <@${interaction.user.id}> zdraví <@${ownerId}>!`, allowedMentions: { users: [interaction.user.id, ownerId] } });
  await interaction.reply({ content: 'Pozdrav je odeslaný.', flags: EPHEMERAL });
}

/* ---------- Najít spoluhráče ---------- */

// Skóre shody: společné hry, styl, doba hraní a otevřenost k novým lidem.
export function score(me, other) {
  let s = me.games.filter((g) => other.games.includes(g)).length * 3;
  if (!s) return 0;
  if (me.style && other.style) s += me.style === other.style ? 2 : me.style === 'both' || other.style === 'both' ? 1 : 0;
  s += (me.times ?? []).filter((t) => (other.times ?? []).includes(t)).length;
  if (other.open_to === 'new') s += 1;
  return s;
}

async function match(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const settings = await getSettings(interaction.guildId);
  const roleMap = settings.roleMap ?? {};
  const mine = await getCard(interaction.guildId, interaction.user.id);
  const meGames = gamesOf(interaction.member, roleMap).games.map((g) => g.id);
  const me = { games: meGames, style: mine?.style, times: mine?.times };
  const sections = [];

  if (!meGames.length) sections.push('Nemáš vybrané žádné hry. Vyber si je v kanálu s rolemi, pak ti poradím líp.');

  // Lidé s vizitkou a podobnými hrami
  const { rows: cards } = await query('SELECT * FROM member_cards WHERE guild_id = $1 AND user_id <> $2 AND message_id IS NOT NULL AND COALESCE(open_to, \'\') <> \'group\'', [interaction.guildId, interaction.user.id]);
  if (cards.length && meGames.length) {
    const members = await interaction.guild.members.fetch({ user: cards.map((c) => c.user_id) }).catch(() => new Map());
    const scored = cards.map((c) => {
      const m = members.get?.(c.user_id);
      if (!m) return null;
      const others = gamesOf(m, roleMap).games;
      const common = others.filter((g) => meGames.includes(g.id));
      return { c, sc: score(me, { games: others.map((g) => g.id), style: c.style, times: c.times, open_to: c.open_to }), common };
    }).filter((x) => x && x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 5);
    if (scored.length) {
      sections.push(`**🧑‍🤝‍🧑 Lidé s podobnými hrami**\n${scored.map((x) => `<@${x.c.user_id}> · ${x.common.map((g) => g.name).join(', ')}${x.c.style ? ` · ${labelOf(STYLES, x.c.style).split(':')[0]}` : ''}`).join('\n')}`);
    }
  }

  // Otevřené party na moje hry
  {
    const { rows: parties } = await query(
      `SELECT p.*, (SELECT count(*) FROM lfg_members m WHERE m.post_id = p.id)::int AS n FROM lfg_posts p
       WHERE p.guild_id = $1 AND p.status = 'open' AND (p.game_id = ANY($2) OR p.game_id = 'chat') ORDER BY p.created_at DESC LIMIT 4`,
      [interaction.guildId, meGames],
    );
    if (parties.length) {
      sections.push(`**🎮 Otevřené party**\n${parties.map((p) => `${p.game_id === 'chat' ? '💬 ' : ''}${p.game_name} · ${p.capacity ? `${p.n}/${p.capacity}` : `${p.n} lidí`} · ${p.time_text || 'co nejdřív'} · [otevřít](https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.message_id})`).join('\n')}`);
    }
  }

  // Nejbližší akce
  const { rows: events } = await query(
    `SELECT * FROM events WHERE guild_id = $1 AND status = 'open' AND starts_at > now() AND starts_at < now() + interval '7 days' ORDER BY starts_at LIMIT 3`,
    [interaction.guildId],
  );
  if (events.length) {
    sections.push(`**📅 Nejbližší akce**\n${events.map((e) => `${e.title} · <t:${Math.floor(new Date(e.starts_at).getTime() / 1000)}:R> · [přihlásit se](https://discord.com/channels/${e.guild_id}/${e.channel_id}/${e.message_id})`).join('\n')}`);
  }

  if (!sections.length || (sections.length === 1 && !meGames.length)) {
    sections.push('Zatím tu není nic, co by sedělo. Zveřejni si vizitku, ať si tě ostatní najdou, nebo založ vlastní hledání.');
  }
  await interaction.editReply({ content: sections.join('\n\n'), allowedMentions: { parse: [] } });
}
