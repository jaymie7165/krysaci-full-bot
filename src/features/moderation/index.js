import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits as P,
  TextInputBuilder, TextInputStyle, escapeMarkdown,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { addHeader, button, divider, newPanel, text } from '../../ui.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const PANEL_FLAGS = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const MAX_MUTE_MIN = 24 * 60;

export const TYPES = {
  notice: { label: 'Upozornění', emoji: '📣', color: colors.accent },
  warn: { label: 'Varování', emoji: '⚠️', color: colors.warning },
  mute: { label: 'Mute', emoji: '🔇', color: colors.warning },
  unmute: { label: 'Zrušení mute', emoji: '🔊', color: colors.success },
  ban: { label: 'Ban', emoji: '🔨', color: colors.danger },
  unban: { label: 'Zrušení banu', emoji: '🕊️', color: colors.success },
  note: { label: 'Poznámka týmu', emoji: '📝', color: colors.neutral },
};

const isStaff = (interaction, settings) =>
  interaction.memberPermissions?.has(P.Administrator) ||
  (settings.staffRole && interaction.member?.roles?.cache?.has(settings.staffRole));

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

/* ---------- Data a pomocné funkce ---------- */

export async function getCounts(guildId, userId) {
  const { rows } = await query('SELECT type, count(*)::int AS n FROM mod_actions WHERE guild_id = $1 AND user_id = $2 GROUP BY type', [guildId, userId]);
  const counts = Object.fromEntries(Object.keys(TYPES).map((t) => [t, 0]));
  for (const r of rows) counts[r.type] = r.n;
  return counts;
}

async function recent(guildId, userId, limit) {
  return (await query('SELECT * FROM mod_actions WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3', [guildId, userId, limit])).rows;
}

// Doporučení k žebříčku sankcí. Je to jen nápověda, rozhoduje moderátor.
export function nextStepHint(c) {
  if (c.warn >= 3 || c.mute >= 2) return 'Opakované porušení: zvaž ban.';
  if (c.warn >= 1 || c.notice >= 2 || c.mute >= 1) return 'Už má předchozí zásah: zvaž mute.';
  return 'Bez historie: stačí upozornění nebo varování.';
}

const line = (a) =>
  `**#${a.id}** ${TYPES[a.type].emoji} ${TYPES[a.type].label} · <t:${unix(a.created_at)}:d> · <@${a.moderator_id}>` +
  `${a.duration_min ? ` · ${a.duration_min} min` : ''}${a.rule ? ` · pravidlo ${a.rule}` : ''}${a.reason ? `\n> ${clip(a.reason.replace(/\n/g, ' '), 160)}` : ''}`;

// Text historie člena (pro příkaz, tlačítko i ticket Odvolání). Vejde se do limitu 2000 znaků.
export async function historyText(guildId, userId) {
  const counts = await getCounts(guildId, userId);
  const rows = await recent(guildId, userId, 15);
  const head = `**Historie <@${userId}>**\n📣 ${counts.notice} · ⚠️ ${counts.warn} · 🔇 ${counts.mute} · 🔨 ${counts.ban} · 📝 ${counts.note}\n\n`;
  if (!rows.length) return `${head}Zatím žádný záznam.`;
  let body = '';
  let shown = 0;
  for (const r of rows) {
    const l = `${line(r)}\n`;
    if (head.length + body.length + l.length > 1900) break;
    body += l;
    shown++;
  }
  return `${head}${body}${rows.length > shown ? `…a dalších ${rows.length - shown} starších` : ''}`.trimEnd();
}

/* ---------- Panel moderace ---------- */

export async function buildModPanel(guildId, user, member) {
  const counts = await getCounts(guildId, user.id);
  const last = await recent(guildId, user.id, 3);
  const mutedUntil = member?.communicationDisabledUntilTimestamp;
  const muted = mutedUntil && mutedUntil > Date.now();

  const lines = [
    `📣 ${counts.notice} · ⚠️ ${counts.warn} · 🔇 ${counts.mute} · 🔨 ${counts.ban} · 📝 ${counts.note}`,
    ...(muted ? [`🔇 **Právě v mute** do <t:${Math.floor(mutedUntil / 1000)}:R>`] : []),
    ...(member?.joinedTimestamp ? [`📅 Na serveru od <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`] : ['📅 Člen už na serveru není']),
  ];
  const container = newPanel(colors.warning);
  addHeader(container, `### 🛡️ Moderace · ${escapeMarkdown(member?.displayName ?? user.username)}\n-# ${user.id}`, (member ?? user).displayAvatarURL({ size: 128 }));
  container.addSeparatorComponents(divider()).addTextDisplayComponents(text(lines.join('\n')));
  if (last.length) container.addTextDisplayComponents(text(`**Poslední zásahy**\n${last.map(line).join('\n')}`));
  container.addTextDisplayComponents(text(`-# ${nextStepHint(counts)} Rozhoduješ ty.`));
  container.addSeparatorComponents(divider());

  const uid = user.id;
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(`mod:act:notice:${uid}`, '📣 Upozornit'), button(`mod:act:warn:${uid}`, '⚠️ Varovat'),
    button(`mod:act:mute:${uid}`, '🔇 Mute'), button(`mod:act:note:${uid}`, '📝 Poznámka'),
  ));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(`mod:hist:${uid}`, '📜 Historie'),
    ...(muted ? [button(`mod:act:unmute:${uid}`, '🔊 Zrušit mute', ButtonStyle.Success)] : []),
    button(`mod:act:ban:${uid}`, '🔨 Ban', ButtonStyle.Danger),
  ));
  return { components: [container], flags: PANEL_FLAGS };
}

// Pravý klik na člena → Aplikace → Moderace
export async function openModPanel(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!isStaff(interaction, settings)) return interaction.reply({ content: 'Tohle může jen tým.', flags: EPHEMERAL });
  await interaction.reply(await buildModPanel(interaction.guildId, interaction.targetUser, interaction.targetMember));
}

/* ---------- Tlačítka a formuláře ---------- */

export async function handleModInteraction(interaction) {
  const [, action, a, b] = interaction.customId.split(':');
  const settings = await getSettings(interaction.guildId);
  if (!isStaff(interaction, settings)) return interaction.reply({ content: 'Tohle může jen tým.', flags: EPHEMERAL });

  if (action === 'hist') return interaction.reply({ content: await historyText(interaction.guildId, a), flags: EPHEMERAL, allowedMentions: { parse: [] } });
  if (action === 'act') {
    if (a === 'unmute') return runAction(interaction, 'unmute', b, { reason: 'Zrušeno moderátorem' }, settings);
    return showModal(interaction, a, b);
  }
  if (action === 'do') {
    const get = (id) => { try { return interaction.fields.getTextInputValue(id).trim(); } catch { return ''; } };
    const data = { reason: get('reason'), rule: get('rule') };
    if (a === 'mute') {
      data.minutes = parseDuration(get('duration'));
      if (!data.minutes) return interaction.reply({ content: `Délku zadej jako číslo minut nebo hodin (např. \`60\`, \`90 min\`, \`12h\`), od 1 minuty do 24 hodin.`, flags: EPHEMERAL });
    }
    return runAction(interaction, a, b, data, settings);
  }
}

// "60", "90 min", "12h" -> minuty (1 až 1440), jinak null
export function parseDuration(input) {
  const m = /^(\d{1,4})\s*(m|min|minut|h|hod|hodin)?$/i.exec(String(input).trim());
  if (!m) return null;
  const n = Number(m[1]);
  const minutes = m[2] && m[2].toLowerCase().startsWith('h') ? n * 60 : n;
  return minutes >= 1 && minutes <= MAX_MUTE_MIN ? minutes : null;
}

function showModal(interaction, type, userId) {
  const t = TYPES[type];
  const field = (id, label, style, extra = {}) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(extra.required ?? true).setMaxLength(extra.max ?? 500)
      .setPlaceholder(extra.placeholder ?? ''),
  );
  const modal = new ModalBuilder().setCustomId(`mod:do:${type}:${userId}`).setTitle(`${t.label}`.slice(0, 45)).addComponents(
    field('reason', type === 'note' ? 'Poznámka (vidí jen tým)' : 'Důvod', TextInputStyle.Paragraph, { placeholder: type === 'ban' ? 'Proč dáváš ban?' : '' }),
  );
  if (type !== 'note') modal.addComponents(field('rule', 'Číslo pravidla (volitelné)', TextInputStyle.Short, { required: false, max: 20, placeholder: 'Např. 2' }));
  if (type === 'mute') modal.addComponents(field('duration', 'Délka (1 min až 24 h)', TextInputStyle.Short, { max: 12, placeholder: 'Např. 60, 90 min, 12h' }));
  return interaction.showModal(modal);
}

/* ---------- Provedení zásahu ---------- */

async function runAction(interaction, type, userId, data, settings) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const guild = interaction.guild;
  const t = TYPES[type];
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user ?? (await interaction.client.users.fetch(userId).catch(() => null));
  if (!user) return interaction.editReply('Tohoto uživatele jsem nenašel.');
  if (userId === interaction.user.id) return interaction.editReply('Na sebe sankci použít nejde.');
  if (userId === interaction.client.user.id) return interaction.editReply('Na bota sankci použít nejde.');

  if (['mute', 'unmute'].includes(type) && !member) return interaction.editReply('Člen už na serveru není.');
  if (type === 'mute' && !member.moderatable) return interaction.editReply('Tomuto členovi mute dát nemůžu (je vyšší v hierarchii než bot, nebo je správce).');
  if (type === 'ban' && member && !member.bannable) return interaction.editReply('Tohoto člena zabanovat nemůžu (je vyšší v hierarchii než bot, nebo je správce).');

  // DM s informací o zásahu (poznámka týmu a zrušení se neposílají). U banu to musí být před banem.
  let dm = null;
  if (['notice', 'warn', 'mute', 'ban'].includes(type)) {
    dm = await notifyUser(interaction, user, type, data, settings);
  }

  try {
    if (type === 'mute') await member.timeout(data.minutes * 60_000, `${t.label}: ${data.reason}`.slice(0, 500));
    if (type === 'unmute') await member.timeout(null, 'Zrušeno moderátorem');
    if (type === 'ban') await guild.members.ban(userId, { reason: `${data.reason}`.slice(0, 500) });
    if (type === 'unban') await guild.bans.remove(userId, `${data.reason}`.slice(0, 500));
  } catch (err) {
    if (err.code === 50013) return interaction.editReply('Bot na to nemá oprávnění. Zkontroluj, že je jeho role nad rolí tohoto člena.');
    if (err.code === 10026) return interaction.editReply('Tento uživatel není zabanovaný.');
    console.error(err);
    return interaction.editReply('Zásah se nepodařilo provést. Zkus to prosím znovu.');
  }

  const { rows: [action] } = await query(
    `INSERT INTO mod_actions (guild_id, user_id, moderator_id, type, reason, rule, duration_min) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [interaction.guildId, userId, interaction.user.id, type, data.reason ?? '', data.rule ?? '', data.minutes ?? null],
  );
  await logAction(interaction.client, settings, action, dm);

  const counts = await getCounts(interaction.guildId, userId);
  const extra = type === 'warn' && counts.warn >= 3 ? `\n⚠️ Člen má už **${counts.warn} varování**. Zvaž mute nebo ban.` : '';
  await interaction.editReply({
    content: `${t.emoji} **${t.label}** pro <@${userId}> je uložený (#${action.id}).${dm === false ? '\nDM se nepodařilo doručit (má je zavřená).' : ''}${extra}`,
    allowedMentions: { parse: [] },
  });
}

async function notifyUser(interaction, user, type, data, settings) {
  const t = TYPES[type];
  const embed = new EmbedBuilder().setColor(t.color).setTitle(`${t.emoji} ${t.label} · ${interaction.guild.name}`)
    .setDescription(data.reason || 'Bez udání důvodu.')
    .setFooter({ text: 'Nesouhlasíš? Otevři na serveru ticket „Odvolání proti trestu“.' });
  if (data.rule) embed.addFields({ name: 'Pravidlo', value: data.rule, inline: true });
  if (data.minutes) embed.addFields({ name: 'Délka', value: data.minutes >= 60 ? `${Math.round((data.minutes / 60) * 10) / 10} h` : `${data.minutes} min`, inline: true });
  const components = [];
  if (settings.ticketPanelChannel) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Podpora').setURL(`https://discord.com/channels/${interaction.guildId}/${settings.ticketPanelChannel}`),
    ));
  }
  return user.send({ embeds: [embed], components }).then(() => true).catch(() => false);
}

async function logAction(client, settings, action, dm) {
  const channel = await client.channels.fetch(settings.modLog ?? settings.ticketLog ?? '0').catch(() => null);
  if (!channel) return;
  const t = TYPES[action.type];
  const embed = new EmbedBuilder().setColor(t.color).setTitle(`${t.emoji} ${t.label} #${action.id}`).addFields(
    { name: 'Člen', value: `<@${action.user_id}>`, inline: true },
    { name: 'Moderátor', value: `<@${action.moderator_id}>`, inline: true },
    ...(action.duration_min ? [{ name: 'Délka', value: `${action.duration_min} min`, inline: true }] : []),
    ...(action.rule ? [{ name: 'Pravidlo', value: action.rule, inline: true }] : []),
    ...(action.reason ? [{ name: 'Důvod', value: clip(action.reason, 1000) }] : []),
  );
  if (dm === false) embed.setFooter({ text: 'DM členovi se nepodařilo doručit' });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

/* ---------- Příkaz /mod ---------- */

export async function modCommand(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!isStaff(interaction, settings)) return interaction.reply({ content: 'Tohle může jen tým.', flags: EPHEMERAL });
  const sub = interaction.options.getSubcommand();
  if (sub === 'historie') {
    const user = interaction.options.getUser('clen', true);
    return interaction.reply({ content: await historyText(interaction.guildId, user.id), flags: EPHEMERAL, allowedMentions: { parse: [] } });
  }
  if (sub === 'unban') {
    const user = interaction.options.getUser('uzivatel', true);
    return runAction(interaction, 'unban', user.id, { reason: interaction.options.getString('duvod') ?? 'Unban' }, settings);
  }
}
