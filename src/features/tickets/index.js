import {
  ActionRowBuilder, AttachmentBuilder, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder,
  PermissionFlagsBits as P, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from 'discord.js';
import { query, getSettings } from '../../db.js';
import { colors } from '../../theme.js';
import { STREAMER_LINK_LABEL, getCategory } from './categories.js';
import { parseStreamLink, registerStreamer } from '../streams/index.js';
import { PRIORITIES, buildPanel, buildTicketMessage, clip, pad, ratingRow } from './ui.js';
import { fetchAllMessages, renderTranscript } from './transcript.js';

const MAX_OPEN_PER_USER = 3;
const EPHEMERAL = MessageFlags.Ephemeral;
const MEMBER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

export async function handleTicketInteraction(interaction) {
  const [, action, ...args] = interaction.customId.split(':');
  switch (action) {
    case 'open': return showCategoryModal(interaction);
    case 'create': return openTicket(interaction, args[0]);
    case 'claim': return claim(interaction);
    case 'add': return addMemberMenu(interaction);
    case 'addpick': return addMembers(interaction);
    case 'priority': return priorityMenu(interaction);
    case 'setpriority': return setPriority(interaction);
    case 'note': return noteModal(interaction);
    case 'notemodal': return saveNote(interaction);
    case 'approve': return approveStreamer(interaction);
    case 'close': return closeModal(interaction);
    case 'closemodal': return closeTicket(interaction);
    case 'rate': return rate(interaction, Number(args[0]), Number(args[1]));
  }
}

/* ---------- Pomocné funkce ---------- */


async function ticketInChannel(channelId) {
  const { rows } = await query(`SELECT * FROM tickets WHERE channel_id = $1 AND status = 'open'`, [channelId]);
  return rows[0];
}

// Ověří, že akci provádí člen týmu. Vrací nastavení, nebo null (a odpoví uživateli).
async function requireStaff(interaction) {
  const settings = await getSettings(interaction.guildId);
  const ok =
    interaction.memberPermissions?.has(P.Administrator) ||
    (settings.staffRole && interaction.member.roles.cache.has(settings.staffRole));
  if (!ok) {
    await interaction.reply({ content: 'Tohle může udělat jen tým.', flags: EPHEMERAL });
    return null;
  }
  return settings;
}

async function refreshPanel(channel, ticket) {
  const message = await channel.messages.fetch(ticket.panel_message_id).catch(() => null);
  await message?.edit(buildTicketMessage(ticket));
}

/* ---------- Vytvoření ticketu ---------- */

async function showCategoryModal(interaction) {
  const category = getCategory(interaction.values[0]);
  const modal = new ModalBuilder().setCustomId(`ticket:create:${category.id}`).setTitle(category.label.slice(0, 45));
  for (const f of category.fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(f.style === 'long' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(f.required !== false)
      .setMaxLength(f.style === 'long' ? 1000 : 200);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  await interaction.showModal(modal);
  // Vrátí výběrové menu do výchozího stavu, aby šla stejná kategorie vybrat znovu.
  interaction.message.edit(buildPanel()).catch(() => {});
}

async function openTicket(interaction, categoryId) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const category = getCategory(categoryId);
  const settings = await getSettings(interaction.guildId);
  if (!settings.ticketCategory || !settings.staffRole) {
    return interaction.editReply('Ticket systém ještě není nastavený. Napiš prosím správci serveru.');
  }

  const { rows: open } = await query(
    `SELECT 1 FROM tickets WHERE guild_id = $1 AND user_id = $2 AND status = 'open'`,
    [interaction.guildId, interaction.user.id],
  );
  if (open.length >= MAX_OPEN_PER_USER) {
    return interaction.editReply(`Máš už ${open.length} otevřené tickety. Počkej, než některý uzavřeme.`);
  }

  const answers = category.fields.map((f) => ({
    label: f.label,
    value: interaction.fields.getTextInputValue(f.id).trim(),
  }));
  const { rows: [ticket] } = await query(
    `INSERT INTO tickets (guild_id, user_id, category, answers) VALUES ($1, $2, $3, $4) RETURNING *`,
    [interaction.guildId, interaction.user.id, category.id, JSON.stringify(answers)],
  );

  try {
    const channel = await interaction.guild.channels.create({
      name: `ticket-${pad(ticket.id)}`,
      type: ChannelType.GuildText,
      parent: settings.ticketCategory,
      topic: `${category.label} · ${interaction.user.username}`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: interaction.user.id, allow: MEMBER_PERMS },
        { id: settings.staffRole, allow: [...MEMBER_PERMS, P.ManageMessages] },
        { id: interaction.client.user.id, allow: [...MEMBER_PERMS, P.ManageChannels] },
      ],
    });
    const message = await channel.send({
      ...buildTicketMessage(ticket, { ping: `<@${interaction.user.id}> <@&${settings.staffRole}>` }),
      allowedMentions: { users: [interaction.user.id], roles: [settings.staffRole] },
    });
    await query('UPDATE tickets SET channel_id = $1, panel_message_id = $2 WHERE id = $3', [channel.id, message.id, ticket.id]);
    await interaction.editReply(`Ticket je připravený: ${channel}`);
  } catch (err) {
    await query('DELETE FROM tickets WHERE id = $1', [ticket.id]);
    throw err;
  }
}

/* ---------- Ovládací tlačítka ---------- */

async function claim(interaction) {
  if (!(await requireStaff(interaction))) return;
  const ticket = await ticketInChannel(interaction.channelId);
  if (!ticket) return;

  if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) {
    return interaction.reply({ content: `Ticket už převzal <@${ticket.claimed_by}>.`, flags: EPHEMERAL });
  }
  const releasing = ticket.claimed_by === interaction.user.id;
  const { rows: [updated] } = await query(
    'UPDATE tickets SET claimed_by = $1 WHERE id = $2 RETURNING *',
    [releasing ? null : interaction.user.id, ticket.id],
  );
  await interaction.update(buildTicketMessage(updated));
  await interaction.channel.send({
    content: `-# <@${interaction.user.id}> ${releasing ? 'uvolnil' : 'převzal'} ticket.`,
    allowedMentions: { parse: [] },
  });
}

async function addMemberMenu(interaction) {
  if (!(await requireStaff(interaction))) return;
  const menu = new UserSelectMenuBuilder()
    .setCustomId('ticket:addpick')
    .setPlaceholder('Vyber člena týmu…')
    .setMinValues(1)
    .setMaxValues(5);
  await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
}

async function addMembers(interaction) {
  const ticket = await ticketInChannel(interaction.channelId);
  if (!ticket) return;
  for (const id of interaction.values) {
    await interaction.channel.permissionOverwrites.edit(id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true,
    });
  }
  await interaction.update({ content: 'Hotovo.', components: [] });
  await interaction.channel.send({
    content: `${interaction.values.map((id) => `<@${id}>`).join(', ')} byl(i) přidán(i) do ticketu.`,
  });
}

async function priorityMenu(interaction) {
  if (!(await requireStaff(interaction))) return;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:setpriority')
    .setPlaceholder('Vyber prioritu…')
    .addOptions(Object.entries(PRIORITIES).map(([value, label]) => ({ label, value })));
  await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
}

async function setPriority(interaction) {
  const ticket = await ticketInChannel(interaction.channelId);
  if (!ticket) return;
  const { rows: [updated] } = await query('UPDATE tickets SET priority = $1 WHERE id = $2 RETURNING *', [interaction.values[0], ticket.id]);
  await refreshPanel(interaction.channel, updated);
  await interaction.update({ content: `Priorita nastavena: **${PRIORITIES[updated.priority]}**.`, components: [] });
}

async function noteModal(interaction) {
  if (!(await requireStaff(interaction))) return;
  const modal = new ModalBuilder().setCustomId('ticket:notemodal').setTitle('Interní poznámka').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('content').setLabel('Poznámka pro tým').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true),
    ),
  );
  await interaction.showModal(modal);
}

async function saveNote(interaction) {
  const ticket = await ticketInChannel(interaction.channelId);
  if (!ticket) return;
  const content = interaction.fields.getTextInputValue('content').trim();
  await query(
    'INSERT INTO ticket_notes (ticket_id, author_id, author_name, content) VALUES ($1, $2, $3, $4)',
    [ticket.id, interaction.user.id, interaction.member.displayName, content],
  );
  // Poznámka se ukáže jen v staff logu, ne v ticketu, který vidí uživatel.
  const settings = await getSettings(interaction.guildId);
  const log = await interaction.client.channels.fetch(settings.ticketLog).catch(() => null);
  await log?.send({
    embeds: [new EmbedBuilder().setColor(colors.neutral).setTitle(`Interní poznámka · Ticket #${pad(ticket.id)}`)
      .setDescription(content).addFields({ name: 'Autor', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Ticket', value: `<#${ticket.channel_id}>`, inline: true })],
  });
  await interaction.reply({ content: 'Poznámka je uložená a vidí ji jen tým.', flags: EPHEMERAL });
}

/* ---------- Schválení žádosti o roli streamera ---------- */

async function approveStreamer(interaction) {
  const settings = await requireStaff(interaction);
  if (!settings) return;
  const ticket = await ticketInChannel(interaction.channelId);
  if (!ticket || ticket.category !== 'streamer') {
    return interaction.reply({ content: 'Toto tlačítko je jen pro žádosti o roli streamera.', flags: EPHEMERAL });
  }
  if (!settings.streamerRole) {
    return interaction.reply({ content: 'Role streamera ještě není nastavená. Správce ji nastaví příkazem /nastaveni streamer.', flags: EPHEMERAL });
  }
  await interaction.deferReply({ flags: EPHEMERAL });
  const member = await interaction.guild.members.fetch(ticket.user_id).catch(() => null);
  if (!member) return interaction.editReply('Žadatel už na serveru není.');

  try {
    await member.roles.add(settings.streamerRole, `Schválil ${interaction.user.username}`);
  } catch (err) {
    if (err.code === 50013) return interaction.editReply('Bot nemá oprávnění tuto roli přidělit. Přetáhni v Nastavení serveru → Role roli bota nad roli streamera.');
    throw err;
  }

  // Kanál z odpovědí ve formuláři rovnou přidáme do oznamování streamů.
  const link = ticket.answers.find((a) => a.label === STREAMER_LINK_LABEL)?.value;
  const parsed = parseStreamLink(link);
  let streamNote = 'Odkaz na kanál jsem nerozpoznal, přidej ho ručně příkazem /stream pridat.';
  if (parsed) {
    const result = await registerStreamer(interaction.guildId, parsed.platform, parsed.login, ticket.user_id);
    streamNote = result.ok ? `${result.text} Jeho streamy se teď budou oznamovat.` : `Kanál se nepodařilo přidat k oznamování: ${result.text}`;
  }

  await interaction.channel.send({
    content: `<@${ticket.user_id}> tvoje žádost byla schválena, dostal(a) jsi roli streamera.`,
    allowedMentions: { users: [ticket.user_id] },
  });
  await interaction.editReply(`Role streamera je přidělená.\n${streamNote}`);
}

/* ---------- Uzavření, transcript, hodnocení ---------- */

async function closeModal(interaction) {
  if (!(await requireStaff(interaction))) return;
  const modal = new ModalBuilder().setCustomId('ticket:closemodal').setTitle('Uzavřít ticket').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Důvod uzavření')
        .setPlaceholder('Uživatel se dozví výsledek').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true),
    ),
  );
  await interaction.showModal(modal);
}

async function closeTicket(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const open = await ticketInChannel(interaction.channelId);
  if (!open) return interaction.editReply('Tento ticket už je uzavřený.');
  const reason = interaction.fields.getTextInputValue('reason').trim();

  const { rows: [ticket] } = await query(
    `UPDATE tickets SET status = 'closed', closed_at = now(), closed_by = $1, close_reason = $2 WHERE id = $3 RETURNING *`,
    [interaction.user.id, reason, open.id],
  );
  const { rows: notes } = await query('SELECT * FROM ticket_notes WHERE ticket_id = $1 ORDER BY created_at', [ticket.id]);
  const category = getCategory(ticket.category);
  const messages = await fetchAllMessages(interaction.channel);
  const opener = await interaction.client.users.fetch(ticket.user_id).catch(() => null);
  const base = {
    ticket, categoryLabel: category.label, guildName: interaction.guild.name, messages,
    openerName: opener?.username ?? ticket.user_id,
  };
  const fileName = `ticket-${pad(ticket.id)}.html`;
  const staffFile = () => new AttachmentBuilder(Buffer.from(renderTranscript({ ...base, notes })), { name: fileName });
  const userFile = () => new AttachmentBuilder(Buffer.from(renderTranscript(base)), { name: fileName });

  // DM žadateli (bez interních poznámek) s možností ohodnotit podporu.
  let dmOk = true;
  try {
    const user = await interaction.client.users.fetch(ticket.user_id);
    await user.send({
      embeds: [new EmbedBuilder().setColor(colors.accent).setTitle('Tvůj ticket byl uzavřen')
        .setDescription(`**Ticket #${pad(ticket.id)}** · ${category.label}\n\n**Výsledek**\n${clip(reason, 1500)}`)
        .setFooter({ text: 'Jak jsi byl spokojený s podporou? 1 = špatně, 5 = výborně' })],
      components: [ratingRow(ticket.id)],
      files: [userFile()],
    });
  } catch {
    dmOk = false;
  }

  // Staff log s plným přepisem včetně poznámek.
  const settings = await getSettings(interaction.guildId);
  const log = await interaction.client.channels.fetch(settings.ticketLog).catch(() => null);
  await log?.send({
    embeds: [new EmbedBuilder().setColor(colors.neutral).setTitle(`Ticket #${pad(ticket.id)} uzavřen`).addFields(
      { name: 'Kategorie', value: category.label, inline: true },
      { name: 'Vytvořil', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'Převzal', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : '—', inline: true },
      { name: 'Uzavřel', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'DM žadateli', value: dmOk ? 'Odesláno' : 'Nelze doručit (zavřené DM)', inline: true },
      { name: 'Důvod', value: clip(reason, 1024) },
    )],
    files: [staffFile()],
  });

  await interaction.editReply('Ticket se uzavírá…');
  await interaction.channel.send('Ticket je uzavřený. Tento kanál se za chvíli smaže.');
  setTimeout(() => interaction.channel.delete('Ticket uzavřen').catch(() => {}), 5000);
}

async function rate(interaction, ticketId, rating) {
  const { rows: [ticket] } = await query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  if (!ticket || ticket.user_id !== interaction.user.id) {
    return interaction.reply({ content: 'Tohle hodnocení není tvoje.', flags: EPHEMERAL });
  }
  if (ticket.rating) {
    return interaction.update({ components: [] });
  }
  await query('UPDATE tickets SET rating = $1 WHERE id = $2', [rating, ticketId]);
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(colors.success).setTitle('Díky za hodnocení')
      .setDescription(`Ticket #${pad(ticket.id)} jsi ohodnotil na ${rating} z 5.`)],
    components: [],
  });
  const settings = await getSettings(ticket.guild_id);
  const log = await interaction.client.channels.fetch(settings.ticketLog).catch(() => null);
  await log?.send({
    embeds: [new EmbedBuilder().setColor(colors.neutral)
      .setDescription(`Hodnocení ticketu **#${pad(ticket.id)}**: **${rating} / 5**`)],
  });
}
