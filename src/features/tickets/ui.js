import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
  SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';
import { getCategory } from './categories.js';

export const PRIORITIES = { low: 'Nízká', normal: 'Normální', high: 'Vysoká', urgent: 'Urgentní' };
const PRIORITY_COLORS = { low: colors.neutral, normal: colors.accent, high: colors.warning, urgent: colors.danger };

export const MAX_OPEN_PER_USER = 3;
export const pad = (id) => String(id).padStart(4, '0');
export const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// Pořadí a rozdělení kategorií v panelu.
const GROUPS = [
  { title: '### 🆘 Potřebuju pomoc', ids: ['general', 'report', 'appeal'] },
  { title: '### 🤝 Chci se zapojit', ids: ['recruit', 'streamer', 'suggestion', 'partner'] },
  { title: null, ids: ['leadership'] },
];

// Obrázek v rohu panelu: ikona serveru, jinak avatar bota.
export const panelIcon = (guild, client) => guild?.iconURL({ size: 256 }) ?? client.user.displayAvatarURL({ size: 256 });

// Veřejný panel "Support Center": každá kategorie je řádek s vlastním tlačítkem.
export function buildPanel({ iconUrl } = {}) {
  const container = new ContainerBuilder().setAccentColor(colors.accent);
  const head = text(
    '## 🛟 Support Center\nPotřebuješ pomoc, nebo se chceš zapojit? Vyber, co řešíš. ' +
    'Otevře se krátký formulář a **soukromý kanál jen pro tebe a náš tým**.',
  );
  if (iconUrl) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(head).setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl)));
  } else {
    container.addTextDisplayComponents(head);
  }

  for (const group of GROUPS) {
    container.addSeparatorComponents(divider());
    if (group.title) container.addTextDisplayComponents(text(group.title));
    for (const id of group.ids) {
      const c = getCategory(id);
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(`${c.emoji} **${c.label}**\n${c.description}${c.badge ? `\n-# ${c.badge}` : ''}`))
          .setButtonAccessory(
            new ButtonBuilder().setCustomId(`ticket:start:${c.id}`).setLabel('Otevřít')
              .setStyle(id === 'general' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          ),
      );
    }
  }
  container
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`-# Najednou můžeš mít až ${MAX_OPEN_PER_USER} otevřené tickety. Screenshoty a soubory můžeš nahrát přímo do ticketu.`));

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

const PRIORITY_EMOJI = { low: '🟢', normal: '🔵', high: '🟠', urgent: '🔴' };
const quote = (value) => value.split('\n').map((line) => `> ${line}`).join('\n');

// Hlavní zpráva uvnitř ticketu. `ping` (text s označením) se přidá jen při vytvoření.
export function buildTicketMessage(ticket, { ping } = {}) {
  const category = getCategory(ticket.category);
  const closed = ticket.status === 'closed';
  const status = closed ? '⚫ Uzavřený' : ticket.claimed_by ? `👤 Převzal <@${ticket.claimed_by}>` : '⏳ Čeká na převzetí';
  const answers = ticket.answers.map((a) => `**${a.label}**\n${clip(quote(a.value || '—'), 700)}`).join('\n\n');

  const head = text(`### 🎫 Ticket #${pad(ticket.id)}\n${category.emoji} **${category.label}**\n-# ${closed ? 'Uzavřený' : 'Otevřený'}`);
  const container = new ContainerBuilder().setAccentColor(PRIORITY_COLORS[ticket.priority] ?? colors.accent);
  if (ticket.opener_avatar) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(head).setThumbnailAccessory(new ThumbnailBuilder().setURL(ticket.opener_avatar)));
  } else {
    container.addTextDisplayComponents(head);
  }
  container
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(
      `**Vytvořil**  <@${ticket.user_id}>\n**Priorita**  ${PRIORITY_EMOJI[ticket.priority] ?? '🔵'} ${PRIORITIES[ticket.priority]}\n**Stav**  ${status}`,
    ))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(answers));

  if (!closed) {
    container
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(text('-# Screenshoty, odkazy a soubory můžeš nahrát přímo sem. Tým se ti ozve v tomto kanálu.'));
    controls(ticket).forEach((row) => container.addActionRowComponents(row));
  }

  return { components: ping ? [text(ping), container] : [container], flags: MessageFlags.IsComponentsV2 };
}

export function ratingRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder().setCustomId(`ticket:rate:${ticketId}:${n}`).setLabel(String(n)).setStyle(ButtonStyle.Secondary),
    ),
  );
}
