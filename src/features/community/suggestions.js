import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits as P,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { checkAchievements } from '../achievements/index.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const EPHEMERAL = MessageFlags.Ephemeral;

const STATUS = {
  open: { label: '🕗 Čeká na posouzení', color: colors.accent },
  approved: { label: '✅ Schváleno', color: colors.success },
  rejected: { label: '❌ Zamítnuto', color: colors.danger },
  done: { label: '🎉 Realizováno', color: colors.success },
};

async function votes(id) {
  const { rows } = await query('SELECT vote, count(*)::int AS n FROM suggestion_votes WHERE suggestion_id = $1 GROUP BY vote', [id]);
  const n = (v) => rows.find((r) => r.vote === v)?.n ?? 0;
  return { up: n(1), down: n(-1) };
}

export async function buildSuggestion(s) {
  const { up, down } = await votes(s.id);
  const st = STATUS[s.status];
  const container = new ContainerBuilder()
    .setAccentColor(st.color)
    .addTextDisplayComponents(text(`### 💡 Návrh #${s.id} · ${s.title}\n-# Od <@${s.author_id}> · ${st.label}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(s.body));

  if (s.status === 'open' || s.status === 'approved') {
    container.addSeparatorComponents(divider()).addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sug:up:${s.id}`).setLabel(`Líbí se · ${up}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`sug:down:${s.id}`).setLabel(`Nelíbí se · ${down}`).setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sug:approve:${s.id}`).setLabel('Schválit').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`sug:reject:${s.id}`).setLabel('Zamítnout').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`sug:done:${s.id}`).setLabel('Realizováno').setStyle(ButtonStyle.Secondary),
      ),
    );
  } else if (up || down) {
    container.addTextDisplayComponents(text(`-# Hlasy: ${up} pro · ${down} proti`));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export async function createSuggestion(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const settings = await getSettings(interaction.guildId);
  const channel = await interaction.guild.channels.fetch(settings.suggestionChannel).catch(() => null);
  if (!channel) return interaction.editReply('Kanál pro návrhy se nepodařilo najít. Napiš prosím správci serveru.');

  const { rows: [s] } = await query(
    'INSERT INTO suggestions (guild_id, channel_id, author_id, title, body) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [interaction.guildId, channel.id, interaction.user.id, interaction.fields.getTextInputValue('title').trim(), interaction.fields.getTextInputValue('body').trim()],
  );
  try {
    const message = await channel.send({ ...(await buildSuggestion(s)), allowedMentions: { parse: [] } });
    await query('UPDATE suggestions SET message_id = $1 WHERE id = $2', [message.id, s.id]);
    await interaction.editReply(`Díky, nápad je zveřejněný: ${message.url}`);
    checkAchievements(interaction.client, interaction.guildId, interaction.user.id);
  } catch (err) {
    await query('DELETE FROM suggestions WHERE id = $1', [s.id]);
    throw err;
  }
}

export async function handleSuggestionInteraction(interaction) {
  const [, action, idRaw] = interaction.customId.split(':');
  const id = Number(idRaw);
  const { rows: [s] } = await query('SELECT * FROM suggestions WHERE id = $1', [id]);
  if (!s) return interaction.reply({ content: 'Tento návrh už neexistuje.', flags: EPHEMERAL });

  if (action === 'up' || action === 'down') {
    if (!['open', 'approved'].includes(s.status)) return interaction.reply({ content: 'Hlasování u tohoto návrhu skončilo.', flags: EPHEMERAL });
    const vote = action === 'up' ? 1 : -1;
    const { rows: [existing] } = await query('SELECT vote FROM suggestion_votes WHERE suggestion_id = $1 AND user_id = $2', [id, interaction.user.id]);
    if (existing?.vote === vote) {
      await query('DELETE FROM suggestion_votes WHERE suggestion_id = $1 AND user_id = $2', [id, interaction.user.id]);
    } else {
      await query(
        `INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES ($1, $2, $3)
         ON CONFLICT (suggestion_id, user_id) DO UPDATE SET vote = $3`,
        [id, interaction.user.id, vote],
      );
    }
    return interaction.update({ ...(await buildSuggestion(s)), allowedMentions: { parse: [] } });
  }

  // Změna stavu: jen tým.
  const settings = await getSettings(interaction.guildId);
  const staff = interaction.memberPermissions?.has(P.Administrator) || (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));
  if (!staff) return interaction.reply({ content: 'Stav návrhu může měnit jen tým.', flags: EPHEMERAL });

  const status = { approve: 'approved', reject: 'rejected', done: 'done' }[action];
  const { rows: [updated] } = await query('UPDATE suggestions SET status = $2 WHERE id = $1 RETURNING *', [id, status]);
  await interaction.update({ ...(await buildSuggestion(updated)), allowedMentions: { parse: [] } });

  // Autorovi pošleme informaci do DM (pokud je má otevřené).
  const author = await interaction.client.users.fetch(s.author_id).catch(() => null);
  await author?.send({
    embeds: [new EmbedBuilder().setColor(STATUS[status].color).setTitle('Aktualizace tvého návrhu')
      .setDescription(`**${s.title}**\nStav: **${STATUS[status].label}**`)],
  }).catch(() => {});
  if (status !== 'rejected') checkAchievements(interaction.client, interaction.guildId, s.author_id);
}
