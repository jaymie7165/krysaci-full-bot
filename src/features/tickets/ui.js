import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';
import { CATEGORIES, getCategory } from './categories.js';

export const PRIORITIES = { low: 'Nízká', normal: 'Normální', high: 'Vysoká', urgent: 'Urgentní' };
const PRIORITY_COLORS = { low: colors.neutral, normal: colors.accent, high: colors.warning, urgent: colors.danger };

export const pad = (id) => String(id).padStart(4, '0');
export const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const gap = () => new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small);

// Veřejný panel "Support Center" s výběrem kategorie.
export function buildPanel() {
  const container = new ContainerBuilder()
    .setAccentColor(colors.accent)
    .addTextDisplayComponents(
      text('## Support Center\nPotřebuješ pomoc? Jsme tu pro tebe.\n**Vyber kategorii, která nejlépe odpovídá tomu, co potřebuješ řešit.**'),
    )
    .addSeparatorComponents(divider());

  CATEGORIES.forEach((c, i) => {
    container.addTextDisplayComponents(
      text(`${c.emoji}  **${c.label}**\n${c.description}${c.badge ? `\n-# ${c.badge}` : ''}`),
    );
    if (i < CATEGORIES.length - 1) container.addSeparatorComponents(gap());
  });

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

  container
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(menu));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function controls(ticket) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:claim').setLabel('Převzít').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket:add').setLabel('Přidat člena').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:priority').setLabel('Priorita').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:note').setLabel('Interní poznámka').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Uzavřít').setStyle(ButtonStyle.Danger),
      ...(ticket.category === 'streamer'
        ? [new ButtonBuilder().setCustomId('ticket:approve').setLabel('Schválit streamera').setStyle(ButtonStyle.Success)]
        : []),
    ),
  ];
}

// Hlavní zpráva uvnitř ticketu. `ping` (text s označením) se přidá jen při vytvoření.
export function buildTicketMessage(ticket, { ping } = {}) {
  const category = getCategory(ticket.category);
  const closed = ticket.status === 'closed';
  const claimed = ticket.claimed_by ? `Převzal <@${ticket.claimed_by}>` : 'Nepřiřazeno';

  const answers = ticket.answers
    .map((a) => `**${a.label}**\n${clip(a.value || '—', 600)}`)
    .join('\n\n');

  const container = new ContainerBuilder()
    .setAccentColor(PRIORITY_COLORS[ticket.priority] ?? colors.accent)
    .addTextDisplayComponents(text(`### Ticket #${pad(ticket.id)}\n${category.label} · ${closed ? 'Uzavřený' : 'Otevřený'}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(`**Vytvořil:** <@${ticket.user_id}>\n**Priorita:** ${PRIORITIES[ticket.priority]}\n**Stav:** ${claimed}`),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(answers));

  if (!closed) {
    container.addSeparatorComponents(divider());
    controls(ticket).forEach((row) => container.addActionRowComponents(row));
  }

  const components = ping ? [text(ping), container] : [container];
  return { components, flags: MessageFlags.IsComponentsV2 };
}

export function ratingRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder().setCustomId(`ticket:rate:${ticketId}:${n}`).setLabel(String(n)).setStyle(ButtonStyle.Secondary),
    ),
  );
}
