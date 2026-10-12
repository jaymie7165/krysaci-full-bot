import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { colors } from '../../theme.js';
import { CATEGORIES, getCategory } from './categories.js';

export const PRIORITIES = { low: 'Nízká', normal: 'Normální', high: 'Vysoká', urgent: 'Urgentní' };
const PRIORITY_COLORS = { low: colors.neutral, normal: colors.accent, high: colors.warning, urgent: colors.danger };

export const pad = (id) => String(id).padStart(4, '0');
export const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Veřejný panel "Support Center" s výběrem kategorie.
export function buildPanel() {
  const list = CATEGORIES.map(
    (c, i) => `**${i + 1}. ${c.label}**\n${c.description}${c.badge ? `\n-# ${c.badge}` : ''}`,
  ).join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(colors.accent)
    .setTitle('Support Center')
    .setDescription(
      `Potřebuješ pomoc? Jsme tu pro tebe.\nVyber kategorii, která nejlépe odpovídá tomu, co potřebuješ řešit.\n\n${list}`,
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:open')
    .setPlaceholder('Vyber kategorii…')
    .addOptions(
      CATEGORIES.map((c) => ({
        label: c.label,
        description: clip(c.description, 100),
        value: c.id,
        emoji: c.emoji,
      })),
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function controls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:claim').setLabel('Převzít').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket:add').setLabel('Přidat člena').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:priority').setLabel('Priorita').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:note').setLabel('Interní poznámka').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Uzavřít').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// Hlavní zpráva uvnitř ticketu (přehled + ovládací tlačítka).
export function buildTicketMessage(ticket) {
  const category = getCategory(ticket.category);
  const closed = ticket.status === 'closed';

  const embed = new EmbedBuilder()
    .setColor(PRIORITY_COLORS[ticket.priority] ?? colors.accent)
    .setTitle(`Ticket #${pad(ticket.id)}`)
    .setDescription(`${category.label} · ${closed ? 'Uzavřený' : 'Otevřený'}`)
    .addFields(
      { name: 'Vytvořil', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'Priorita', value: PRIORITIES[ticket.priority], inline: true },
      { name: 'Stav', value: ticket.claimed_by ? `Převzal <@${ticket.claimed_by}>` : 'Nepřiřazeno', inline: true },
      ...ticket.answers.map((a) => ({ name: a.label, value: clip(a.value || '—', 1024) })),
    )
    .setTimestamp(new Date(ticket.created_at));

  return { embeds: [embed], components: closed ? [] : controls() };
}

export function ratingRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder().setCustomId(`ticket:rate:${ticketId}:${n}`).setLabel(String(n)).setStyle(ButtonStyle.Secondary),
    ),
  );
}
