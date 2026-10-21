import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder, MessageFlags, ModalBuilder,
  PermissionFlagsBits as P, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { BAR, colors } from '../../theme.js';

const PREFIX = `〉🎧${BAR} `;
const EPHEMERAL = MessageFlags.Ephemeral;
const humans = (channel) => channel.members.filter((m) => !m.user.bot);

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

export function buildLoungePanel(lounge) {
  const id = lounge.channel_id;
  const container = new ContainerBuilder()
    .setAccentColor(colors.accent)
    .addTextDisplayComponents(text(
      '### 🎧 Tvoje roomka\nSprávce může roomku přejmenovat, nastavit limit míst nebo ji zamknout. ' +
      'Když odejde, správcem se stane někdo další, kdo tu zůstane. Prázdná roomka se sama smaže.',
    ))
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lounge:rename:${id}`).setLabel('Přejmenovat').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lounge:limit:${id}`).setLabel('Limit míst').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lounge:lock:${id}`).setLabel(lounge.locked ? 'Odemknout' : 'Zamknout')
          .setStyle(lounge.locked ? ButtonStyle.Danger : ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ---------- Události hlasových kanálů ---------- */

export async function onVoiceStateUpdate(oldState, newState) {
  const settings = await getSettings(newState.guild.id);
  const left = oldState.channelId && oldState.channelId !== newState.channelId;

  if (
    settings.loungeCreator && newState.channelId === settings.loungeCreator &&
    oldState.channelId !== newState.channelId && newState.member && !newState.member.user.bot
  ) {
    await createLounge(newState, settings);
  }
  if (left) await handleLeave(oldState);
}

async function createLounge(state, settings) {
  const { guild, member } = state;

  // Každý člen má najednou jednu roomku: pokud ji už má, jen ho do ní přesuneme.
  const { rows: [existing] } = await query('SELECT channel_id FROM lounges WHERE guild_id = $1 AND owner_id = $2', [guild.id, member.id]);
  if (existing) {
    const channel = await guild.channels.fetch(existing.channel_id).catch(() => null);
    if (channel) return void (await member.voice.setChannel(channel).catch(() => {}));
    await query('DELETE FROM lounges WHERE channel_id = $1', [existing.channel_id]);
  }

  const channel = await guild.channels.create({
    name: `${PREFIX}${member.displayName}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: settings.loungeCategory ?? state.channel?.parentId ?? null,
    reason: 'Voice Lounge',
    // Viditelná a otevřená pro všechny, dokud ji správce nezamkne.
    permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [P.ViewChannel, P.Connect] }],
  });
  const { rows: [lounge] } = await query('INSERT INTO lounges (channel_id, guild_id, owner_id) VALUES ($1, $2, $3) RETURNING *', [channel.id, guild.id, member.id]);

  const moved = await member.voice.setChannel(channel).then(() => true).catch(() => false);
  if (!moved) {
    // Člen mezitím odešel, takže roomku rovnou uklidíme.
    await query('DELETE FROM lounges WHERE channel_id = $1', [channel.id]);
    return void (await channel.delete('Člen odešel dřív, než byl přesunut').catch(() => {}));
  }
  await channel.send(buildLoungePanel(lounge)).catch(() => {});
}

async function handleLeave(oldState) {
  const { rows: [lounge] } = await query('SELECT * FROM lounges WHERE channel_id = $1', [oldState.channelId]);
  if (!lounge) return;
  const channel = oldState.channel ?? (await oldState.guild.channels.fetch(oldState.channelId).catch(() => null));
  if (!channel) {
    await query('DELETE FROM lounges WHERE channel_id = $1', [lounge.channel_id]);
    return;
  }
  const present = humans(channel);
  if (present.size === 0) {
    await query('DELETE FROM lounges WHERE channel_id = $1', [lounge.channel_id]);
    await channel.delete('Voice Lounge je prázdná').catch(() => {});
    return;
  }
  if (lounge.owner_id === oldState.id) {
    const next = present.first();
    await query('UPDATE lounges SET owner_id = $2 WHERE channel_id = $1', [lounge.channel_id, next.id]);
    await channel.send({ content: `Nový správce roomky: <@${next.id}>`, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

// Po restartu bota uklidí roomky, které mezitím osiřely.
export async function cleanupLounges(client) {
  const { rows } = await query('SELECT * FROM lounges');
  for (const lounge of rows) {
    const channel = await client.channels.fetch(lounge.channel_id).catch(() => null);
    if (!channel) {
      await query('DELETE FROM lounges WHERE channel_id = $1', [lounge.channel_id]);
    } else if (humans(channel).size === 0) {
      await query('DELETE FROM lounges WHERE channel_id = $1', [lounge.channel_id]);
      await channel.delete('Voice Lounge je prázdná').catch(() => {});
    }
  }
}

/* ---------- Ovládání roomky ---------- */

export async function handleLoungeInteraction(interaction) {
  const [, action, channelId] = interaction.customId.split(':');
  const { rows: [lounge] } = await query('SELECT * FROM lounges WHERE channel_id = $1', [channelId]);
  if (!lounge) return interaction.reply({ content: 'Tato roomka už neexistuje.', flags: EPHEMERAL });
  if (interaction.user.id !== lounge.owner_id) {
    return interaction.reply({ content: 'Roomku ovládá jen její správce.', flags: EPHEMERAL });
  }
  switch (action) {
    case 'rename': return showModal(interaction, 'renamemodal', channelId, 'Přejmenovat roomku', 'name', 'Nový název', 40);
    case 'renamemodal': return rename(interaction, channelId);
    case 'limit': return showModal(interaction, 'limitmodal', channelId, 'Limit míst', 'limit', 'Počet míst (0 = bez limitu)', 2);
    case 'limitmodal': return setLimit(interaction, channelId);
    case 'lock': return toggleLock(interaction, lounge);
  }
}

const showModal = (interaction, action, channelId, title, fieldId, label, max) =>
  interaction.showModal(
    new ModalBuilder().setCustomId(`lounge:${action}:${channelId}`).setTitle(title).addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(fieldId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max),
      ),
    ),
  );

async function rename(interaction, channelId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return interaction.editReply('Roomka už neexistuje.');
  const name = `${PREFIX}${interaction.fields.getTextInputValue('name').trim()}`.slice(0, 100);
  // Discord povoluje jen 2 přejmenování za 10 minut; nečekáme déle než pár vteřin.
  const done = await Promise.race([
    channel.setName(name).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]).catch(() => false);
  await interaction.editReply(done ? 'Přejmenováno.' : 'Discord omezuje přejmenování (2× za 10 minut). Změna se projeví, jakmile to bude možné.');
}

async function setLimit(interaction, channelId) {
  const n = Number.parseInt(interaction.fields.getTextInputValue('limit'), 10);
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    return interaction.reply({ content: 'Zadej číslo od 0 do 99 (0 znamená bez limitu).', flags: EPHEMERAL });
  }
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return interaction.reply({ content: 'Roomka už neexistuje.', flags: EPHEMERAL });
  await channel.setUserLimit(n);
  await interaction.reply({ content: n ? `Limit míst: ${n}.` : 'Limit míst je zrušený.', flags: EPHEMERAL });
}

async function toggleLock(interaction, lounge) {
  const channel = await interaction.guild.channels.fetch(lounge.channel_id).catch(() => null);
  if (!channel) return interaction.reply({ content: 'Roomka už neexistuje.', flags: EPHEMERAL });
  const locked = !lounge.locked;
  await interaction.deferUpdate();
  if (locked) {
    // Ti, kdo jsou uvnitř, se mohou vrátit; ostatní se nepřipojí.
    for (const m of humans(channel).values()) await channel.permissionOverwrites.edit(m.id, { Connect: true }).catch(() => {});
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
  } else {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: true });
  }
  const { rows: [updated] } = await query('UPDATE lounges SET locked = $2 WHERE channel_id = $1 RETURNING *', [lounge.channel_id, locked]);
  await interaction.editReply(buildLoungePanel(updated));
}
