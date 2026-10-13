import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';
import { RANKS } from '../roles/data.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// Správný tvar pro čeština: 1 hráče, 2-4 hráče, 5+ hráčů
export const hraci = (n) => (n === 1 ? '1 hráče' : n >= 2 && n <= 4 ? `${n} hráče` : `${n} hráčů`);

const STATUS_COLORS = { open: colors.accent, full: colors.success, closed: colors.neutral, expired: colors.neutral };

export function buildPost(post, members, { ping } = {}) {
  const count = members.length;
  const missing = Math.max(post.capacity - count, 0);
  const titles = {
    open: `Hledáme ${hraci(missing)} · ${post.game_name}`,
    full: `Parta je kompletní · ${post.game_name}`,
    closed: `Hledání ukončeno · ${post.game_name}`,
    expired: `Hledání vypršelo · ${post.game_name}`,
  };

  const rankLabel = RANKS[post.game_id] ? 'Rank' : 'Obtížnost';
  const lines = [
    ['Režim', post.mode_text],
    [rankLabel, post.rank_text],
    ['Čas', post.time_text],
    ['Atmosféra', post.vibe_text],
  ].filter(([, v]) => v).map(([k, v]) => `**${k}:** ${v}`);

  if (post.status !== 'open') {
    lines.push(`**Hráči:** ${members.map((m) => `<@${m.user_id}>`).join(', ')}`);
  }
  if (post.status === 'full' && post.voice_channel_id) lines.push(`**Voice:** <#${post.voice_channel_id}>`);

  const container = new ContainerBuilder()
    .setAccentColor(STATUS_COLORS[post.status] ?? colors.accent)
    .addTextDisplayComponents(text(`### ${titles[post.status]}\n-# Zakladatel: <@${post.founder_id}> · ${count}/${post.capacity}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(lines.length ? lines.join('\n') : '—'));

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
