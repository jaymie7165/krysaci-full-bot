import {
  ActionRowBuilder, ButtonStyle, ContainerBuilder, MessageFlags, ModalBuilder, SectionBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, TextInputBuilder, TextInputStyle, ThumbnailBuilder,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { ACHIEVEMENTS, earnedKeys, metrics } from '../achievements/index.js';
import { hasKey } from '../riot/api.js';
import { AGES, GAMES, RANKS } from '../roles/data.js';
import { createSuggestion } from './suggestions.js';
import { addFooter, addHeader, addRow, asMessage, button, newPanel } from '../../ui.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const EPHEMERAL = MessageFlags.Ephemeral;

export function buildCommunityPanel({ iconUrl } = {}) {
  const container = newPanel();
  addHeader(container, '## 👥 Komunita\nTvůj profil, nápady pro server a propojení s LoL na jednom místě.', iconUrl);
  container.addSeparatorComponents(divider());
  addRow(container, {
    emoji: '🪪', label: 'Můj profil', description: 'Hry, rank, odehrané zápasy a získané milníky.',
    button: button('community:profile', 'Zobrazit', ButtonStyle.Primary),
  });
  addRow(container, {
    emoji: '💡', label: 'Navrhnout nápad', description: 'Nová funkce, hra nebo event? Komunita o tom může hlasovat.',
    button: button('community:suggest', 'Navrhnout'),
  });
  if (hasKey()) {
    addRow(container, {
      emoji: '🏷️', label: 'Propojit LoL účet', description: 'Rank se pak nastaví sám a týmy v customkách a turnajích budou vyváženější.',
      button: button('riot:link', 'Propojit'),
    });
  }
  addFooter(container, 'Všechno tady je dobrovolné. Profil vidíš jen ty.');
  return asMessage(container);
}

export async function handleCommunityInteraction(interaction) {
  const action = interaction.customId.split(':')[1];
  if (action === 'profile') return showProfile(interaction);
  if (action === 'suggest') return showSuggestModal(interaction);
  if (action === 'suggestmodal') return createSuggestion(interaction);
}

async function showSuggestModal(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!settings.suggestionChannel) {
    return interaction.reply({ content: 'Návrhy ještě nejsou nastavené. Napiš prosím správci serveru.', flags: EPHEMERAL });
  }
  const title = new TextInputBuilder().setCustomId('title').setLabel('Název nápadu').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true);
  const body = new TextInputBuilder().setCustomId('body').setLabel('Popis').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)
    .setPlaceholder('Co navrhuješ a jak by to komunitě pomohlo?');
  await interaction.showModal(
    new ModalBuilder().setCustomId('community:suggestmodal').setTitle('Nový nápad')
      .addComponents(new ActionRowBuilder().addComponents(title), new ActionRowBuilder().addComponents(body)),
  );
}

async function showProfile(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL | MessageFlags.IsComponentsV2 });
  const { guildId, member, user } = interaction;
  const map = (await getSettings(guildId)).roleMap ?? {};
  const has = (key) => map[key] && member.roles.cache.has(map[key]);

  const games = GAMES.filter((g) => has(`game:${g.id}`)).map((g) => g.name);
  const age = AGES.find((a) => has(`age:${a.id}`))?.name;
  const ranks = Object.keys(RANKS).flatMap((gameId) => {
    const idx = RANKS[gameId].findIndex((_, i) => has(`rank:${gameId}:${i}`));
    const game = GAMES.find((g) => g.id === gameId);
    return idx >= 0 ? [`${game.short} · ${RANKS[gameId][idx]}`] : [];
  });

  const { rows: [link] } = await query('SELECT riot_id, tier, division FROM riot_links WHERE guild_id = $1 AND user_id = $2 AND verified', [guildId, user.id]);
  const { rows: [profile] } = await query('SELECT other_activities FROM profiles WHERE guild_id = $1 AND user_id = $2', [guildId, user.id]);
  const m = await metrics(guildId, user.id);
  const earned = new Set(await earnedKeys(guildId, user.id));

  const lines = [
    `🎮 **Hry:** ${games.join(', ') || '—'}`,
    `🏅 **Ranky:** ${ranks.join(', ') || '—'}`,
    `🎂 **Věk:** ${age ?? '—'}`,
  ];
  if (profile?.other_activities?.length) lines.push(`✨ **Další aktivity:** ${profile.other_activities.join(', ')}`);
  if (link) lines.push(`🏷️ **LoL účet:** ${link.riot_id}${link.tier ? ` · ${link.tier[0]}${link.tier.slice(1).toLowerCase()} ${link.division}` : ''}`);

  const stats = [
    `Custom hry: **${m.customGames}** (výhry ${m.customWins})`,
    `Party: založeno **${m.lfgPosts}**, připojeno **${m.lfgJoined}**`,
    `Eventy: **${m.events}**`,
    `Turnaje: **${m.tourPlayed}** (výhry ${m.tourWins})`,
  ];
  const badges = ACHIEVEMENTS.filter((a) => earned.has(a.key)).map((a) => a.name);

  const container = new ContainerBuilder()
    .setAccentColor(colors.accent)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`### 🪪 ${member.displayName}\n${lines.join('\n')}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(member.displayAvatarURL({ size: 128 }))),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`📊 **Statistiky**\n${stats.join('\n')}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`🎖️ **Milníky** · ${badges.length} z ${ACHIEVEMENTS.length}\n${badges.join(' · ') || 'Zatím žádné. První získáš třeba zapojením do customky nebo eventu.'}`));

  await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
