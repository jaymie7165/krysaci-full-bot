import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, escapeMarkdown,
} from 'discord.js';
import { getSettings } from '../../db.js';
import { colors } from '../../theme.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const link = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

// Veřejné přivítání: viditelné pro všechny, ale nikoho neoznačí ani nepingne.
async function sendChannelWelcome(member, settings) {
  const channel = await member.guild.channels.fetch(settings.welcomeChannel).catch(() => null);
  if (!channel) return;
  const name = escapeMarkdown(member.displayName);
  const where = settings.rolesChannel ? `\nRole si vybereš v <#${settings.rolesChannel}>.` : '';
  const container = new ContainerBuilder().setAccentColor(colors.accent).addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        text(`### 👋 Vítej, ${name}!\nJsi ${member.guild.memberCount}. člen naší komunity. Ať se ti tu líbí.${where}`),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(member.user.displayAvatarURL({ size: 128 }))),
  );
  await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

// Soukromá zpráva s průvodcem.
async function sendDm(member, settings) {
  const guild = member.guild;
  const container = new ContainerBuilder()
    .setAccentColor(colors.accent)
    .addTextDisplayComponents(
      text(`### 👋 Vítej na serveru ${escapeMarkdown(guild.name)}\nRádi tě tu máme. Tady je krátký průvodce, ať se hned zorientuješ.`),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(
        '**🧩 1. Vyber si role**\nV kanálu pro role zvolíš hry, které hraješ, věkovou kategorii a rank. Díky tomu tě ostatní snadno najdou.\n\n' +
        '**💬 2. Seznam se s ostatními**\nNapiš pár slov do chatu, nebo se přidej do voice kanálu. Nikdo tu nekouše.\n\n' +
        '**🎫 3. Potřebuješ pomoc?**\nV kanálu Support otevřeš ticket a náš tým se ti ozve.\n\n' +
        '**📜 Pravidla**\nChovej se k ostatním s respektem, to je celé.',
      ),
    );

  const buttons = [];
  if (settings.rolesChannel) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Vybrat role').setURL(link(guild.id, settings.rolesChannel)));
  }
  if (settings.ticketPanelChannel) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Support').setURL(link(guild.id, settings.ticketPanelChannel)));
  }
  if (buttons.length) {
    container.addSeparatorComponents(divider()).addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
  }
  await member.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

// Vrací { channel: bool, dm: bool } kvůli testovacímu příkazu.
export async function welcomeMember(member) {
  const settings = await getSettings(member.guild.id);
  const result = { channel: false, dm: false };
  if (settings.welcomeChannel) {
    result.channel = await sendChannelWelcome(member, settings).then(() => true).catch((e) => { console.error(e); return false; });
  }
  result.dm = await sendDm(member, settings).then(() => true).catch(() => false);
  return result;
}

export async function onMemberAdd(member) {
  if (member.user.bot) return;
  await welcomeMember(member);
}
