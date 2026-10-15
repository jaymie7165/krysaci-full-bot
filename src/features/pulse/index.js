import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, PermissionFlagsBits as P,
  SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { GAMES } from '../roles/data.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_VOTES = 3;
const OPTIONS = [...GAMES.map((g) => ({ id: g.id, name: g.name })), { id: 'other', name: 'Něco jiného' }];

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
// Správný tvar: hlasoval 1 člověk, hlasovali 2-4 lidé, hlasovalo 0 nebo 5+ lidí
const voted = (n) => (n === 1 ? 'hlasoval 1 člověk' : n >= 2 && n <= 4 ? `hlasovali ${n} lidé` : `hlasovalo ${n} lidí`);
const bar = (n, max) => '▰'.repeat(max ? Math.round((n / max) * 8) : 0).padEnd(8, '▱');

const getPulse = async (id) => (await query('SELECT * FROM pulses WHERE id = $1', [id])).rows[0];

async function results(id) {
  const { rows } = await query('SELECT option_id, count(*)::int AS n FROM pulse_votes WHERE pulse_id = $1 GROUP BY option_id', [id]);
  const { rows: [{ voters }] } = await query('SELECT count(DISTINCT user_id)::int AS voters FROM pulse_votes WHERE pulse_id = $1', [id]);
  const counts = OPTIONS.map((o) => ({ ...o, n: rows.find((r) => r.option_id === o.id)?.n ?? 0 })).sort((a, b) => b.n - a.n);
  return { counts, voters };
}

export async function buildPulse(pulse) {
  const { counts, voters } = await results(pulse.id);
  const open = pulse.status === 'open';
  const top = counts[0]?.n ?? 0;
  const lines = counts.filter((c) => c.n > 0).slice(0, 8).map((c) => `**${c.name}**\n${bar(c.n, top)} ${c.n}`);

  const container = new ContainerBuilder()
    .setAccentColor(open ? colors.accent : colors.success)
    .addTextDisplayComponents(text(
      `### ${pulse.question}\n-# ${open ? `Hlasování končí <t:${unix(pulse.ends_at)}:R>` : 'Hlasování skončilo'} · ${voted(voters)}` +
      (open ? ` · každý může vybrat až ${MAX_VOTES} hry` : ''),
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(lines.join('\n\n') || 'Zatím nikdo nehlasoval. Buď první.'));

  if (!open && top > 0) {
    const winners = counts.filter((c) => c.n === top).map((c) => c.name);
    container.addTextDisplayComponents(text(`**Vítěz:** ${winners.join(', ')}`));
  }
  if (open) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`pulse:vote:${pulse.id}`)
      .setPlaceholder('Vyber, co chceš hrát…')
      .setMinValues(0)
      .setMaxValues(MAX_VOTES)
      .addOptions(OPTIONS.map((o) => ({ label: o.name, value: o.id })));
    container.addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pulse:close:${pulse.id}`).setLabel('Uzavřít hlasování').setStyle(ButtonStyle.Secondary),
      ));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ---------- Příkaz /pulse vytvorit ---------- */

export async function createPulse(interaction) {
  const settings = await getSettings(interaction.guildId);
  const staff = interaction.memberPermissions?.has(P.Administrator) || (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));
  if (!staff) return interaction.reply({ content: 'Tohle může jen tým.', flags: EPHEMERAL });
  await interaction.deferReply({ flags: EPHEMERAL });

  const hours = interaction.options.getInteger('trvani_hodin') ?? 48;
  const role = interaction.options.getRole('role');
  const { rows: [pulse] } = await query(
    `INSERT INTO pulses (guild_id, channel_id, question, ends_at, created_by) VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval, $5) RETURNING *`,
    [interaction.guildId, interaction.channelId, interaction.options.getString('otazka') ?? 'Co budeme hrát o víkendu?', String(hours), interaction.user.id],
  );
  try {
    const payload = await buildPulse(pulse);
    if (role) payload.components.unshift(text(`<@&${role.id}>`));
    const message = await interaction.channel.send({ ...payload, allowedMentions: { roles: role ? [role.id] : [] } });
    await query('UPDATE pulses SET message_id = $1 WHERE id = $2', [message.id, pulse.id]);
    await interaction.editReply(`Hlasování je zveřejněné: ${message.url}`);
  } catch (err) {
    await query('DELETE FROM pulses WHERE id = $1', [pulse.id]);
    throw err;
  }
}

/* ---------- Hlasování a uzavření ---------- */

export async function handlePulseInteraction(interaction) {
  const [, action, idRaw] = interaction.customId.split(':');
  const id = Number(idRaw);
  const pulse = await getPulse(id);
  if (!pulse || pulse.status !== 'open') {
    return interaction.reply({ content: 'Toto hlasování už skončilo.', flags: EPHEMERAL });
  }

  if (action === 'vote') {
    // Nový výběr nahradí předchozí hlasy člena (prázdný výběr hlasy zruší).
    await query('DELETE FROM pulse_votes WHERE pulse_id = $1 AND user_id = $2', [id, interaction.user.id]);
    for (const option of interaction.values) {
      await query('INSERT INTO pulse_votes (pulse_id, user_id, option_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, interaction.user.id, option]);
    }
    return interaction.update(await buildPulse(pulse));
  }

  if (action === 'close') {
    const settings = await getSettings(interaction.guildId);
    const staff = interaction.memberPermissions?.has(P.Administrator) || (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));
    if (!staff) return interaction.reply({ content: 'Hlasování může uzavřít jen tým.', flags: EPHEMERAL });
    await interaction.deferUpdate();
    await closePulse(interaction.client, id);
  }
}

async function closePulse(client, id) {
  const { rows: [pulse] } = await query(`UPDATE pulses SET status = 'closed' WHERE id = $1 AND status = 'open' RETURNING *`, [id]);
  if (!pulse) return;
  const channel = await client.channels.fetch(pulse.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(pulse.message_id).catch(() => null);
  await message?.edit(await buildPulse(pulse));

  const { counts } = await results(id);
  const top = counts[0]?.n ?? 0;
  if (top > 0) {
    const winners = counts.filter((c) => c.n === top).map((c) => `**${c.name}**`).join(', ');
    await channel?.send({ content: `Hlasování skončilo. Nejvíc hlasů (${top}) má ${winners}. Chceš na to založit event? Použij \`/event vytvorit\`.`, allowedMentions: { parse: [] } });
  }
}

export function startPulseSweeper(client) {
  const run = async () => {
    const { rows } = await query(`SELECT id FROM pulses WHERE status = 'open' AND ends_at <= now()`);
    for (const { id } of rows) await closePulse(client, id).catch(console.error);
  };
  run().catch(console.error);
  setInterval(() => run().catch(console.error), 60_000);
}
