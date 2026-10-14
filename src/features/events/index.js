import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits as P,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { checkAchievements } from '../achievements/index.js';
import { parseCzechDateTime } from './time.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const EPHEMERAL = MessageFlags.Ephemeral;
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

const getEvent = async (id) => (await query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
const getSignups = async (id) => (await query('SELECT * FROM event_signups WHERE event_id = $1 ORDER BY joined_at', [id])).rows;
const goingOf = (ev, signups) => (ev.capacity ? signups.slice(0, ev.capacity) : signups);

export function buildEvent(ev, signups, { ping } = {}) {
  const going = goingOf(ev, signups);
  const waiting = ev.capacity ? signups.slice(ev.capacity) : [];
  const ts = unix(ev.starts_at);
  const accent = { open: colors.accent, done: colors.success, cancelled: colors.neutral }[ev.status];

  const names = going.map((s) => `<@${s.user_id}>`).join(', ');
  const list = names.length > 1200 ? `${going.length} hráčů` : names || '—';
  const info = [
    `**Přihlášení** · ${going.length}${ev.capacity ? `/${ev.capacity}` : ''}`,
    list,
    ...(waiting.length ? [`-# Čekací listina: ${waiting.length}`] : []),
  ].join('\n');

  const stateNote = { open: '', done: '\n-# Event proběhl.', cancelled: '\n-# Event byl zrušen.' }[ev.status];
  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(text(`### ${ev.title}\n<t:${ts}:F> · <t:${ts}:R>${stateNote}`));
  if (ev.description) container.addTextDisplayComponents(text(ev.description));
  container.addSeparatorComponents(divider()).addTextDisplayComponents(text(info));

  if (ev.status === 'open') {
    container.addSeparatorComponents(divider()).addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:join:${ev.id}`).setLabel('Přihlásit se').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`event:leave:${ev.id}`).setLabel('Odhlásit se').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`event:cancel:${ev.id}`).setLabel('Zrušit event').setStyle(ButtonStyle.Danger),
      ),
    );
  }
  return { components: ping ? [text(ping), container] : [container], flags: MessageFlags.IsComponentsV2 };
}

export async function handleEventInteraction(interaction) {
  const [, action, a, b] = interaction.customId.split(':');
  if (action === 'create') return createEvent(interaction, a, b);
  const id = Number(a);
  if (action === 'join') return join(interaction, id);
  if (action === 'leave') return leave(interaction, id);
  if (action === 'cancel') return cancel(interaction, id);
}

// Vstup z příkazu /event vytvorit: otevře formulář.
export async function showCreateEventModal(interaction) {
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('kanal');
  const field = (id, label, style, extra = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(extra.required ?? true).setMaxLength(extra.max ?? 100);
    if (extra.placeholder) t.setPlaceholder(extra.placeholder);
    return new ActionRowBuilder().addComponents(t);
  };
  const modal = new ModalBuilder().setCustomId(`event:create:${role?.id ?? 0}:${channel?.id ?? 0}`).setTitle('Nový event').addComponents(
    field('title', 'Název', TextInputStyle.Short, { max: 80 }),
    field('when', 'Kdy (český čas)', TextInputStyle.Short, { placeholder: 'Např. 20.10. 20:00' }),
    field('desc', 'Popis', TextInputStyle.Paragraph, { required: false, max: 600 }),
    field('cap', 'Limit míst (prázdné = bez limitu)', TextInputStyle.Short, { required: false, max: 3 }),
  );
  await interaction.showModal(modal);
}

async function createEvent(interaction, roleId, channelId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const f = (id) => interaction.fields.getTextInputValue(id).trim();
  const startsAt = parseCzechDateTime(f('when'));
  if (!startsAt) return interaction.editReply('Datum jsem nepochopil. Použij tvar `20.10. 20:00` nebo `20.10.2026 20:00`.');
  if (startsAt.getTime() <= Date.now()) return interaction.editReply('Toto datum už je v minulosti.');

  let capacity = null;
  if (f('cap')) {
    capacity = Number.parseInt(f('cap'), 10);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) return interaction.editReply('Limit míst musí být číslo od 1 do 200.');
  }
  const channel = channelId !== '0' ? await interaction.guild.channels.fetch(channelId).catch(() => null) : interaction.channel;
  if (!channel) return interaction.editReply('Kanál se nepodařilo najít.');

  // Událost, která začíná za méně než hodinu, už připomínku nepotřebuje.
  const soon = startsAt.getTime() - Date.now() < 60 * 60_000;
  const { rows: [ev] } = await query(
    `INSERT INTO events (guild_id, channel_id, title, description, starts_at, capacity, created_by, reminded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [interaction.guildId, channel.id, f('title'), f('desc'), startsAt, capacity, interaction.user.id, soon],
  );
  try {
    const ping = roleId !== '0' ? `<@&${roleId}>` : undefined;
    const message = await channel.send({ ...buildEvent(ev, [], { ping }), allowedMentions: { roles: ping ? [roleId] : [] } });
    await query('UPDATE events SET message_id = $1 WHERE id = $2', [message.id, ev.id]);
    await interaction.editReply(`Event je zveřejněný: ${message.url}`);
  } catch (err) {
    await query('DELETE FROM events WHERE id = $1', [ev.id]);
    throw err;
  }
}

const inactive = (interaction) => interaction.reply({ content: 'Tento event už není aktivní.', flags: EPHEMERAL });

async function join(interaction, id) {
  const ev = await getEvent(id);
  if (!ev || ev.status !== 'open') return inactive(interaction);
  const ins = await query('INSERT INTO event_signups (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [id, interaction.user.id]);
  if (!ins.rowCount) return interaction.reply({ content: 'Už jsi přihlášený.', flags: EPHEMERAL });

  const signups = await getSignups(id);
  await interaction.update(buildEvent(ev, signups));
  if (ev.capacity && signups.findIndex((s) => s.user_id === interaction.user.id) >= ev.capacity) {
    await interaction.followUp({ content: 'Event je plný, jsi na čekací listině. Když se uvolní místo, dám ti vědět.', flags: EPHEMERAL });
  }
}

async function leave(interaction, id) {
  const ev = await getEvent(id);
  if (!ev || ev.status !== 'open') return inactive(interaction);
  const before = await getSignups(id);
  const position = before.findIndex((s) => s.user_id === interaction.user.id);
  if (position < 0) return interaction.reply({ content: 'Na eventu nejsi přihlášený.', flags: EPHEMERAL });
  await query('DELETE FROM event_signups WHERE event_id = $1 AND user_id = $2', [id, interaction.user.id]);

  const after = await getSignups(id);
  await interaction.update(buildEvent(ev, after));
  // Uvolnilo se místo z čekací listiny.
  if (ev.capacity && position < ev.capacity && before.length > ev.capacity) {
    const promoted = before[ev.capacity].user_id;
    await interaction.channel.send({
      content: `<@${promoted}>, uvolnilo se místo a jsi v eventu **${ev.title}**.`,
      allowedMentions: { users: [promoted] },
    });
  }
}

async function cancel(interaction, id) {
  const settings = await getSettings(interaction.guildId);
  const staff = interaction.memberPermissions?.has(P.Administrator) || (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));
  if (!staff) return interaction.reply({ content: 'Event může zrušit jen tým.', flags: EPHEMERAL });
  const { rows: [ev] } = await query(`UPDATE events SET status = 'cancelled' WHERE id = $1 AND status = 'open' RETURNING *`, [id]);
  if (!ev) return inactive(interaction);
  await interaction.update(buildEvent(ev, await getSignups(id)));
}

/* ---------- Připomínky a start na pozadí ---------- */

const mentions = (going) => going.slice(0, 60).map((s) => `<@${s.user_id}>`).join(' ') + (going.length > 60 ? ` a dalších ${going.length - 60}` : '');

async function refreshEvent(client, ev) {
  const channel = await client.channels.fetch(ev.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(ev.message_id).catch(() => null);
  await message?.edit(buildEvent(ev, await getSignups(ev.id)));
  return channel;
}

async function sweep(client) {
  const { rows: remind } = await query(
    `UPDATE events SET reminded = true WHERE status = 'open' AND NOT reminded AND starts_at > now() AND starts_at <= now() + interval '60 minutes' RETURNING *`,
  );
  for (const ev of remind) {
    try {
      const going = goingOf(ev, await getSignups(ev.id));
      const channel = await client.channels.fetch(ev.channel_id).catch(() => null);
      if (going.length) {
        await channel?.send({
          content: `Připomínka: **${ev.title}** začíná <t:${unix(ev.starts_at)}:R>.\n${mentions(going)}`,
          allowedMentions: { users: going.slice(0, 60).map((s) => s.user_id) },
        });
      }
    } catch (err) { console.error(err); }
  }

  const { rows: starting } = await query(
    `UPDATE events SET status = 'done', started = true, reminded = true WHERE status = 'open' AND starts_at <= now() RETURNING *`,
  );
  for (const ev of starting) {
    try {
      const going = goingOf(ev, await getSignups(ev.id));
      const ids = going.map((s) => s.user_id);
      if (ids.length) await query('UPDATE event_signups SET attended = true WHERE event_id = $1 AND user_id = ANY($2)', [ev.id, ids]);
      const channel = await refreshEvent(client, ev);
      if (going.length) {
        await channel?.send({ content: `**${ev.title}** právě začíná!\n${mentions(going)}`, allowedMentions: { users: ids.slice(0, 60) } });
      }
      for (const id of ids) await checkAchievements(client, ev.guild_id, id);
    } catch (err) { console.error(err); }
  }
}

export function startEventSweeper(client) {
  const run = () => sweep(client).catch(console.error);
  run();
  setInterval(run, 60_000);
}
