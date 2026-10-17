// Společné stavební kameny vzhledu: hlavička s obrázkem, řádek s tlačítkem a patička.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
  SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { colors } from './theme.js';

export const text = (content) => new TextDisplayBuilder().setContent(content);
export const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
export const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

// Obrázek v rohu panelu: ikona serveru, jinak avatar bota.
export const panelIcon = (guild, client) => guild?.iconURL({ size: 256 }) ?? client.user.displayAvatarURL({ size: 256 });

export const newPanel = (color = colors.accent) => new ContainerBuilder().setAccentColor(color);
export const asMessage = (container) => ({ components: [container], flags: MessageFlags.IsComponentsV2 });

// Hlavička: text vlevo, obrázek vpravo (když je k dispozici).
export function addHeader(container, content, iconUrl) {
  if (iconUrl) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text(content)).setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl)));
  } else {
    container.addTextDisplayComponents(text(content));
  }
  return container;
}

// Řádek panelu: ikona, název, popis a štítek vlevo, tlačítko vpravo.
export function addRow(container, { emoji, label, description, badge, button: btn }) {
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(text(`${emoji} **${label}**\n${description}${badge ? `\n-# ${badge}` : ''}`))
      .setButtonAccessory(btn),
  );
  return container;
}

export function addFooter(container, content) {
  return container.addSeparatorComponents(divider()).addTextDisplayComponents(text(`-# ${content}`));
}

export { ActionRowBuilder, ButtonStyle };
