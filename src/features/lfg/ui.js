import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SectionBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';
import { RANKS } from '../roles/data.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// Správný tvar pro čeština: 1 hráče, 2-4 hráče, 5+ hráčů
export const hraci = (n) => (n === 1 ? '1 hráče' : n >= 2 && n <= 4 ? `${n} hráče` : `${n} hráčů`);

const STATUS_COLORS = { open: colors.accent, full: colors.success, closed: colors.neutral, expired: colors.neutral };

const bar = (n, max) => '▰'.repeat(Math.min(n, max)) + '▱'.repeat(Math.max(max - n, 0));

export function buildPost(post, members, { ping } = {}) {
  const count = members.length;
  const missing = Math.max(post.capacity - count, 0);
  const subtitles = {
    open: `**Hledáme ${hraci(missing)}** · ${count}/${post.capacity}`,
    full: `**Parta je kompletní** · ${count}/${post.capacity}`,
    closed: `**Hledání ukončeno** · ${count}/${post.capacity}`,
    expired: `**Hledání vypršelo** · ${count}/${post.capacity}`,
  };

  const rankLabel = RANKS[post.game_id] ? 'Rank' : 'Obtížnost';
  const details = [
    ['Režim', post.mode_text],
    [rankLabel, post.rank_text],
    ['Čas', post.time_text],
    ['Atmosféra', post.vibe_text],
  ].filter(([, v]) => v).map(([k, v]) => `-# ${k}\n${v}`);

  if (post.status !== 'open') {
    details.push(`-# Hráči\n${members.map((m) => `<@${m.user_id}>`).join(', ')}`);
  }
  if (post.status === 'full' && post.voice_channel_id) details.push(`-# Voice\n<#${post.voice_channel_id}>`);

  const head = text(
    `### ${post.game_name}\n${subtitles[post.status]}\n${bar(count, post.capacity)}\n-# Zakladatel: <@${post.founder_id}>`,
  );

  const container = new ContainerBuilder().setAccentColor(STATUS_COLORS[post.status] ?? colors.accent);
  if (post.founder_avatar) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(head).setThumbnailAccessory(new ThumbnailBuilder().setURL(post.founder_avatar)),
    );
  } else {
    container.addTextDisplayComponents(head);
  }
  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(text(details.length ? details.join('\n') : '—'));

  if (post.status === 'open') {
    container.addSeparatorComponents(divider()).addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lfg:join:${post.id}`).setLabel('Připojit se').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`lfg:leave:${post.id}`).setLabel('Odejít').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lfg:players:${post.id}`).setLabel('Zobrazit hráče').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lfg:close:${post.id}`).setLabel('Zavřít').setStyle(ButtonStyle.Danger),
      ),
    );
  }

  const components = ping ? [text(ping), container] : [container];
  return { components, flags: MessageFlags.IsComponentsV2 };
}

export function buildLfgPanel() {
  const container = new ContainerBuilder()
    .setAccentColor(colors.accent)
    .addTextDisplayComponents(
      text(
        '## Hledání spoluhráčů\nHledáš někoho do party? Klikni na tlačítko, vyplň pár údajů a bot ti vytvoří příspěvek. ' +
        'Až se parta naplní, dostane vlastní voice roomku.\n-# Příspěvek vyprší po 24 hodinách. Najednou můžeš mít jedno aktivní hledání.',
      ),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lfg:new').setLabel('Založit hledání').setStyle(ButtonStyle.Primary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
