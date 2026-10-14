import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { colors } from '../../theme.js';
import { RANKS } from '../roles/data.js';
import { roundName } from './bracket.js';

export const FORMATS = { pavouk: 'Pavouk (vyřazovací)', liga: 'Liga (každý s každým)' };
export const TEAM_SIZE = 5;
export const MIN_PLAYERS = TEAM_SIZE * 2;

const text = (c) => new TextDisplayBuilder().setContent(c);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

export function buildTournament(t, players, teams, { ping } = {}) {
  const accent = { signup: colors.accent, running: colors.accent, finished: colors.success, cancelled: colors.neutral }[t.status];
  const container = new ContainerBuilder().setAccentColor(accent)
    .addTextDisplayComponents(text(`### ${t.name}\n-# ${FORMATS[t.format]} · Organizátor: <@${t.created_by}>`))
    .addSeparatorComponents(divider());

  if (t.status === 'signup') {
    const names = players.map((p) => `<@${p.user_id}>`).join(', ');
    container.addTextDisplayComponents(text(
      `**Přihlášení hráči** · ${players.length}/${t.max_players}\n${clip(names, 1500) || '—'}\n\n` +
      `-# Týmy po ${TEAM_SIZE} hráčích se vylosují vyváženě podle ranku (propojený LoL účet, jinak rank role). Minimum je ${MIN_PLAYERS} hráčů.`,
    ));
  } else {
    const block = teams.map((team) => {
      const members = players.filter((p) => p.team_id === team.id).sort((a, b) => (b.rank_idx ?? -1) - (a.rank_idx ?? -1));
      const lines = members.map((p) => `<@${p.user_id}>${p.rank_idx != null ? ` · ${RANKS.lol[p.rank_idx]}` : ''}${p.user_id === team.captain_id ? ' (kapitán)' : ''}`);
      return `**${team.name}**\n${lines.join('\n')}`;
    }).join('\n\n');
    container.addTextDisplayComponents(text(clip(block || '—', 3300)));
    const subs = players.filter((p) => !p.team_id);
    if (subs.length) container.addTextDisplayComponents(text(`-# Náhradníci: ${subs.map((p) => `<@${p.user_id}>`).join(', ')}`));
    if (t.status === 'finished') {
      const winner = teams.find((x) => x.id === t.winner_team);
      container.addTextDisplayComponents(text(`**Vítěz:** ${winner?.name ?? '—'}`));
    }
    if (t.status === 'cancelled') container.addTextDisplayComponents(text('-# Turnaj byl zrušen.'));
  }

  if (t.status === 'signup') {
    container.addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(btn(`tour:join:${t.id}`, 'Přihlásit se', ButtonStyle.Primary), btn(`tour:leave:${t.id}`, 'Odhlásit se')))
      .addActionRowComponents(new ActionRowBuilder().addComponents(btn(`tour:start:${t.id}`, 'Vytvořit týmy a rozlosovat', ButtonStyle.Success), btn(`tour:cancel:${t.id}`, 'Zrušit turnaj', ButtonStyle.Danger)));
  } else if (t.status === 'running') {
    container.addSeparatorComponents(divider())
      .addActionRowComponents(new ActionRowBuilder().addComponents(btn(`tour:result:${t.id}`, 'Zapsat výsledek', ButtonStyle.Primary), btn(`tour:cancel:${t.id}`, 'Zrušit turnaj', ButtonStyle.Danger)));
  }
  return { components: ping ? [text(ping), container] : [container], flags: MessageFlags.IsComponentsV2 };
}

const matchLine = (m, name) => {
  const a = m.team_a ? name(m.team_a) : 'čeká na postup';
  const b = m.team_b ? name(m.team_b) : 'čeká na postup';
  if (m.winner && (!m.team_a || !m.team_b)) return `**${name(m.winner)}** · volný postup`;
  if (m.winner) return `${a} vs ${b} → **${name(m.winner)}**`;
  return `${a} vs ${b}`;
};

export function buildBracket(t, teams, matches) {
  const name = (id) => teams.find((x) => x.id === id)?.name ?? '?';
  const container = new ContainerBuilder().setAccentColor(colors.accent);

  if (t.format === 'pavouk') {
    const rounds = Math.max(...matches.map((m) => m.round));
    container.addTextDisplayComponents(text(`### Pavouk · ${t.name}`)).addSeparatorComponents(divider());
    for (let r = 1; r <= rounds; r++) {
      const lines = matches.filter((m) => m.round === r).sort((x, y) => x.idx - y.idx).map((m) => matchLine(m, name));
      container.addTextDisplayComponents(text(`**${roundName(r, rounds)}**\n${lines.join('\n')}`));
    }
  } else {
    const wins = new Map(teams.map((x) => [x.id, 0]));
    matches.filter((m) => m.winner).forEach((m) => wins.set(m.winner, (wins.get(m.winner) ?? 0) + 1));
    const table = [...teams].sort((x, y) => wins.get(y.id) - wins.get(x.id) || x.seed - y.seed)
      .map((x, i) => `${i + 1}. **${x.name}** · ${wins.get(x.id)} výher`);
    const open = matches.filter((m) => !m.winner).sort((x, y) => x.round - y.round || x.idx - y.idx);
    const upcoming = open.slice(0, 8).map((m) => `Kolo ${m.round} · ${name(m.team_a)} vs ${name(m.team_b)}`);
    container.addTextDisplayComponents(text(`### Tabulka · ${t.name}`)).addSeparatorComponents(divider())
      .addTextDisplayComponents(text(clip(table.join('\n'), 1800)))
      .addTextDisplayComponents(text(`**Nadcházející zápasy** · odehráno ${matches.length - open.length} z ${matches.length}\n${upcoming.join('\n') || '—'}`));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
