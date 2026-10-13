import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';
import { RANKS } from '../roles/data.js';

export const POSITIONS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT', 'FLEX'];
export const TEAM_SIZE = 5;
export const STARTERS = TEAM_SIZE * 2;

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const bar = (n, max) => '▰'.repeat(Math.min(n, max)) + '▱'.repeat(Math.max(max - n, 0));

const line = (p, i) => {
  const rank = p.rank_idx != null ? RANKS.lol[p.rank_idx] : null;
  return `${i + 1}. <@${p.user_id}>${p.positions ? ` · ${p.positions}` : ''}${rank ? ` · ${rank}` : ''}`;
};

const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

export function buildLobby(lobby, players) {
  const id = lobby.id;
  const modeLabel = lobby.mode === 'aram' ? 'ARAM' : '5v5';
  const header =
    `### League of Legends — Custom Game\n-# Organizátor: <@${lobby.organizer_id}> · Režim: ${modeLabel} · Lobby #${id}` +
    (lobby.note ? `\n${lobby.note}` : '');

  const accent = { open: colors.accent, teams: colors.accent, finished: colors.success, cancelled: colors.neutral }[lobby.status];
  const container = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(text(header)).addSeparatorComponents(divider());

  const teamBlock = (label, emoji, team) => {
    const list = players.filter((p) => p.team === team);
    return `**${emoji} ${label}** · ${list.length} hráčů\n${list.map(line).join('\n') || '—'}`;
  };

  if (lobby.status === 'open') {
    const starters = players.slice(0, STARTERS);
    const subs = players.slice(STARTERS);
    const slots = Array.from({ length: STARTERS }, (_, i) => (starters[i] ? line(starters[i], i) : `-# ${i + 1}. Volné místo`));
    container
      .addTextDisplayComponents(text(`**Přihlášení hráči** · ${starters.length} z ${STARTERS}\n${bar(starters.length, STARTERS)}`))
      .addTextDisplayComponents(text(slots.join('\n')));
    if (subs.length) {
      container.addTextDisplayComponents(text(`**Náhradníci**\n${subs.map((p, i) => line(p, i)).join('\n')}`));
    }
  } else {
    container
      .addTextDisplayComponents(text(teamBlock('Blue Team', '🔵', 'blue')))
      .addTextDisplayComponents(text(teamBlock('Red Team', '🔴', 'red')));
    const subs = players.filter((p) => !p.team);
    if (subs.length) container.addTextDisplayComponents(text(`**Náhradníci**\n${subs.map((p, i) => line(p, i)).join('\n')}`));
    if (lobby.status === 'finished') {
      container.addTextDisplayComponents(text(`**Vítěz:** ${lobby.winner === 'blue' ? '🔵 Blue Team' : '🔴 Red Team'}`));
    }
    if (lobby.status === 'teams' && lobby.voice_blue) {
      container.addTextDisplayComponents(text(`-# Voice: <#${lobby.voice_blue}> · <#${lobby.voice_red}>`));
    }
    if (lobby.status === 'cancelled') container.addTextDisplayComponents(text('-# Lobby bylo uzavřeno.'));
  }

  if (lobby.status === 'open') {
    const row1 = [btn(`custom:join:${id}`, 'Připojit se', ButtonStyle.Primary), btn(`custom:leave:${id}`, 'Odejít')];
    if (lobby.mode !== 'aram') row1.push(btn(`custom:pos:${id}`, 'Pozice'));
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(row1))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(btn(`custom:split:${id}`, 'Rozdělit týmy'), btn(`custom:cancel:${id}`, 'Uzavřít lobby', ButtonStyle.Danger)),
      );
  } else if (lobby.status === 'teams') {
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(`custom:win:${id}:blue`, 'Vyhrál Blue', ButtonStyle.Primary),
          btn(`custom:win:${id}:red`, 'Vyhrál Red', ButtonStyle.Danger),
        ),
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(`custom:move:${id}`, 'Přesunout hráče'),
          btn(`custom:split:${id}`, 'Znovu rozdělit'),
          btn(`custom:cancel:${id}`, 'Zrušit hru'),
        ),
      );
  } else if (lobby.status === 'finished') {
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(btn(`custom:rematch:${id}`, 'Nová hra se stejnými hráči', ButtonStyle.Primary)));
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
