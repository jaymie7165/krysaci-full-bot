import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder,
  SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder,
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

const linkBtn = (url) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🎮 Spustit hru').setURL(url);
const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

// Stav draftu: kdo hraje (sudý počet, max. 10), kdo je ještě k výběru a kdo čeká jako náhradník.
function draftState(players) {
  const n = Math.min(players.length, STARTERS);
  const starters = players.slice(0, n - (n % 2));
  return { starters, pool: starters.filter((p) => !p.team), rest: players.slice(starters.length) };
}

// names (volitelné): { userId: zobrazované jméno } pro nabídku výběru v draftu
export function buildLobby(lobby, players, { names = {} } = {}) {
  const id = lobby.id;
  const modeLabel = lobby.mode === 'aram' ? 'ARAM' : '5v5';
  const header =
    `### ⚔️ League of Legends — Custom Game\n-# Organizátor: <@${lobby.organizer_id}> · Režim: ${modeLabel} · Lobby #${id}` +
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
      .addTextDisplayComponents(text(`👥 **Přihlášení hráči** · ${starters.length} z ${STARTERS}\n${bar(starters.length, STARTERS)}`))
      .addTextDisplayComponents(text(slots.join('\n')));
    if (subs.length) {
      container.addTextDisplayComponents(text(`🪑 **Náhradníci**\n${subs.map((p, i) => line(p, i)).join('\n')}`));
    }
  } else if (lobby.status === 'draft') {
    const { pool, rest } = draftState(players);
    const order = lobby.draft_order ?? '';
    const turn = lobby.draft_turn ?? 0;
    const side = order[turn] === 'A' ? 'blue' : 'red';
    const captain = side === 'blue' ? lobby.draft_blue : lobby.draft_red;
    const draftTeam = (label, emoji, team, cap) => {
      const list = players.filter((p) => p.team === team).sort((a, b) => (b.user_id === cap) - (a.user_id === cap));
      return `**${emoji} ${label}** · ${list.length} hráčů\n${list.map((p, i) => `${line(p, i)}${p.user_id === cap ? ' 👑' : ''}`).join('\n') || '—'}`;
    };
    container
      .addTextDisplayComponents(text(draftTeam('Blue Team', '🔵', 'blue', lobby.draft_blue)))
      .addTextDisplayComponents(text(draftTeam('Red Team', '🔴', 'red', lobby.draft_red)))
      .addTextDisplayComponents(text(`🎯 **Draft** · výběr ${Math.min(turn + 1, order.length)} z ${order.length}\nNa řadě: <@${captain}> (${side === 'blue' ? '🔵 Blue' : '🔴 Red'})`))
      .addTextDisplayComponents(text(`🪑 **K výběru**\n${pool.map((p, i) => line(p, i)).join('\n') || '—'}`));
    if (rest.length) container.addTextDisplayComponents(text(`-# Náhradníci: ${rest.map((p) => `<@${p.user_id}>`).join(', ')}`));
  } else {
    container
      .addTextDisplayComponents(text(teamBlock('Blue Team', '🔵', 'blue')))
      .addTextDisplayComponents(text(teamBlock('Red Team', '🔴', 'red')));
    const subs = players.filter((p) => !p.team);
    if (subs.length) container.addTextDisplayComponents(text(`🪑 **Náhradníci**\n${subs.map((p, i) => line(p, i)).join('\n')}`));
    if (lobby.status === 'finished') {
      container.addTextDisplayComponents(text(`🏆 **Vítěz:** ${lobby.winner === 'blue' ? '🔵 Blue Team' : '🔴 Red Team'}`));
    }
    const rooms = [lobby.voice_blue, lobby.voice_red].filter(Boolean);
    if (lobby.status === 'teams' && rooms.length) {
      container.addTextDisplayComponents(text(`-# Voice: ${rooms.map((id) => `<#${id}>`).join(' · ')}`));
    }
    if (lobby.status === 'cancelled') container.addTextDisplayComponents(text('-# Lobby bylo uzavřeno.'));
  }

  if (lobby.status === 'open') {
    const row1 = [btn(`custom:join:${id}`, 'Připojit se', ButtonStyle.Primary), btn(`custom:leave:${id}`, 'Odejít')];
    if (lobby.mode !== 'aram') row1.push(btn(`custom:pos:${id}`, 'Pozice'));
    if (lobby.join_link) row1.push(linkBtn(lobby.join_link));
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(row1))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(btn(`custom:split:${id}`, 'Rozdělit týmy'), btn(`custom:link:${id}`, '🔗 Odkaz do LoL'), btn(`custom:cancel:${id}`, 'Uzavřít lobby', ButtonStyle.Danger)),
      );
  } else if (lobby.status === 'draft') {
    const { pool } = draftState(players);
    container.addSeparatorComponents(divider());
    if (pool.length) {
      const menu = new StringSelectMenuBuilder().setCustomId(`custom:pick:${id}`).setPlaceholder('Kapitán na řadě: vyber hráče…').addOptions(
        pool.map((p) => ({
          label: `${names[p.user_id] ?? p.user_id}${p.rank_idx != null ? ` · ${RANKS.lol[p.rank_idx]}` : ''}`.slice(0, 100),
          value: p.user_id,
        })),
      );
      container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    }
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        btn(`custom:draftauto:${id}`, 'Dokončit automaticky'),
        btn(`custom:draftcancel:${id}`, 'Zrušit draft', ButtonStyle.Danger),
        ...(lobby.join_link ? [linkBtn(lobby.join_link)] : []),
      ),
    );
  } else if (lobby.status === 'teams') {
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(`custom:win:${id}:blue`, 'Vyhrál Blue', ButtonStyle.Primary),
          btn(`custom:win:${id}:red`, 'Vyhrál Red', ButtonStyle.Danger),
          ...(lobby.join_link ? [linkBtn(lobby.join_link)] : []),
        ),
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          btn(`custom:move:${id}`, 'Přesunout hráče'),
          btn(`custom:split:${id}`, 'Znovu rozdělit'),
          btn(`custom:link:${id}`, '🔗 Odkaz do LoL'),
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
