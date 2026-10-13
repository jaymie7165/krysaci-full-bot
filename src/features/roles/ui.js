import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

export function buildRolesPanel() {
  const container = new ContainerBuilder()
    .setAccentColor(colors.accent)
    .addTextDisplayComponents(
      text('## Vyber si role\nŘekni nám, co hraješ a jak na tom jsi, ať tě ostatní snadno najdou. Role si můžeš kdykoli změnit.'),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(
        '**Hry**\nVyber hry, které hraješ.\n\n' +
        '**Věk**\nTvoje věková kategorie.\n\n' +
        '**Ranky**\nRank v hrách, které to podporují (LoL, Valorant, CS2).\n\n' +
        '**Jiná hra**\nHraješ nebo děláš něco, co v seznamu není? Napiš to sem.',
      ),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roles:games').setLabel('Hry').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('roles:age').setLabel('Věk').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('roles:ranks').setLabel('Ranky').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('roles:other').setLabel('Jiná hra').setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
