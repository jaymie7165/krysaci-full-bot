import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SectionBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';
import { RANKS } from '../roles/data.js';
import { addFooter, addHeader, addRow, asMessage, button, newPanel } from '../../ui.js';

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// Správný tvar pro čeština: 1 hráče, 2-4 hráče, 5+ hráčů
const lidi = (n) => (n === 1 ? '1 člověk' : n >= 2 && n <= 4 ? `${n} lidé` : `${n} lidí`);
export const hraci = (n) => (n === 1 ? '1 hráče' : n >= 2 && n <= 4 ? `${n} hráče` : `${n} hráčů`);

const STATUS_COLORS = { open: colors.accent, full: colors.success, closed: colors.neutral, expired: colors.neutral };

// Ukazatel má nejvýš 12 dílků, aby se u velkých part nezalamoval; u malých odpovídá počtu míst.
const bar = (n, max) => {
  const segments = Math.min(max, 12);
  let filled = Math.round((n / max) * segments);
  if (n > 0 && filled === 0) filled = 1;
  if (n < max && filled === segments) filled = segments - 1;
  return '▰'.repeat(filled) + '▱'.repeat(segments - filled);
};

export function buildPost(post, members, { ping } = {}) {
  const count = members.length;
  const unlimited = post.capacity === 0; // pokec bez hry a bez limitu lidí
  const missing = Math.max(post.capacity - count, 0);
  const subtitles = unlimited ? {
    open: `**Kdokoli se může přidat** · ${lidi(count)}`,
    full: `**Pokec běží** · ${lidi(count)}`,
    closed: `**Pokec ukončen** · ${lidi(count)}`,
    expired: `**Pokec vypršel** · ${lidi(count)}`,
  } : {
    open: `**Hledáme ${hraci(missing)}** · ${count}/${post.capacity}`,
    full: `**Parta je kompletní** · ${count}/${post.capacity}`,
    closed: `**Hledání ukončeno** · ${count}/${post.capacity}`,
    expired: `**Hledání vypršelo** · ${count}/${post.capacity}`,
  };

  const rankLabel = RANKS[post.game_id] ? 'Rank' : 'Obtížnost';
  const details = [
    [unlimited ? '💬 Téma' : '🎯 Režim', post.mode_text],
    [`🏅 ${rankLabel}`, post.rank_text],
    ['🕗 Čas', post.time_text],
    [unlimited ? '🙋 O zakladateli' : '💬 Atmosféra', post.vibe_text],
  ].filter(([, v]) => v).map(([k, v]) => `**${k}**  ${v}`);

  if (post.status !== 'open') {
    const shown = members.slice(0, 40).map((m) => `<@${m.user_id}>`).join(', ');
    details.push(`👥 **Hráči**  ${shown}${members.length > 40 ? ` a dalších ${members.length - 40}` : ''}`);
  }
  if (unlimited && post.status === 'open' && members.length) {
    const who = members.slice(0, 10).map((m) => `<@${m.user_id}>`).join(', ');
    details.push(`👥 **Kdo je tu**  ${who}${members.length > 10 ? ` a dalších ${members.length - 10}` : ''}`);
  }
  if (post.voice_channel_id && (post.status === 'full' || (unlimited && post.status === 'open'))) details.push(`🔊 **Voice**  <#${post.voice_channel_id}>`);

  const head = text(
    `### ${unlimited ? '💬' : '🎮'} ${post.game_name}\n${subtitles[post.status]}\n${unlimited ? '' : `${bar(count, post.capacity)}\n`}-# Zakladatel: <@${post.founder_id}>`,
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

export function buildLfgPanel({ iconUrl } = {}) {
  const container = newPanel();
  addHeader(
    container,
    '## 🎮 Hledání spoluhráčů\nChceš hrát a nemáš s kým? Založ hledání, bot dá vědět těm, kdo danou hru hrají, a když se parta naplní, postaví jí voice roomku. Nechceš hrát, jen si pokecat a poznat někoho nového? I na to tu je volba.',
    iconUrl,
  );
  container.addSeparatorComponents(divider());
  addRow(container, {
    emoji: '🔎', label: 'Založit hledání', description: 'Vyber hru a napiš, kolik lidí hledáš. Nebo zvol pokec bez hry a bez limitu.',
    button: button('lfg:new', 'Založit hledání', ButtonStyle.Primary),
  });
  addFooter(container, 'Hledání po 24 hodinách samo vyprší. Najednou můžeš mít jedno aktivní. Funguje i příkaz /lfg.');
  return asMessage(container);
}
