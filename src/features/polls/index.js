import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { addHeader, button, divider, newPanel, panelIcon, text } from '../../ui.js';
import { scheduleBoardUpdate } from '../tonight/board.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const SEGMENTS = 14;
const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Rozpracované hlasování: volby z příkazu čekají na odeslání formuláře (max. 15 minut).
const drafts = new Map();

/* ---------- Výpočty ---------- */

const hlasu = (n) => (n === 1 ? '1 hlas' : n >= 2 && n <= 4 ? `${n} hlasy` : `${n} hlasů`);

export const bar = (share) => {
  const filled = Math.round(share * SEGMENTS);
  return '▰'.repeat(filled) + '▱'.repeat(SEGMENTS - filled);
};

export async function tally(pollId) {
  const { rows } = await query('SELECT choice, count(*)::int AS n FROM poll_ballots WHERE poll_id = $1 GROUP BY choice', [pollId]);
  const n = (c) => rows.find((r) => r.choice === c)?.n ?? 0;
  const yes = n('yes');
  const no = n('no');
  const abstain = n('abstain');
  const cast = yes + no;
  const pctYes = cast ? Math.round((yes / cast) * 100) : 0;
  return { yes, no, abstain, cast, voters: cast + abstain, pctYes, pctNo: cast ? 100 - pctYes : 0 };
}

const fetchedGuilds = new Set();

// Kolik lidí smí hlasovat (podle role, jinak všichni lidé na serveru). Seznam členů se jednou stáhne celý.
export async function eligibleCount(guild, roleId) {
  if (!guild.members?.cache) return null;
  if (!fetchedGuilds.has(guild.id)) {
    await guild.members.fetch?.().catch(() => {});
    fetchedGuilds.add(guild.id);
  }
  const members = guild.members.cache;
  if (roleId) return members.filter((m) => !m.user.bot && m.roles.cache.has(roleId)).size;
  const bots = members.filter((m) => m.user.bot).size;
  return Math.max((guild.memberCount ?? 0) - bots, 0);
}

/* ---------- Vzhled ---------- */

export function buildPoll(poll, t, { iconUrl, eligible } = {}) {
  const open = poll.status === 'open';
  const ends = unix(poll.ends_at);
  const color = poll.color ?? colors.accent;
  const container = newPanel(open ? color : colors.neutral);

  addHeader(
    container,
    `# 🗳️ ${poll.title}\n-# ${open ? `Hlasování komunity · končí <t:${ends}:R>` : `Hlasování skončilo <t:${unix(poll.closed_at ?? poll.ends_at)}:f>`}`,
    iconUrl,
  );
  if (poll.description) container.addSeparatorComponents(divider()).addTextDisplayComponents(text(poll.description));
  container.addSeparatorComponents(divider());

  const turnout = `👥 Hlasovalo **${t.voters}**${eligible && eligible >= t.voters ? ` z **${eligible}** (${Math.round((t.voters / eligible) * 100)} %)` : ''}`;
  const hidden = open && poll.hide_results;
  const lines = [];
  if (!open) {
    const win = t.yes === t.no ? '⚖️ Remíza' : t.yes > t.no ? `✅ Vítězí: ${poll.yes_label}` : `❌ Vítězí: ${poll.no_label}`;
    lines.push(`## ${t.cast ? win : '🤷 Nikdo nehlasoval'}`);
  }
  lines.push(`### ❓ ${poll.question}`);
  if (hidden) {
    lines.push('🔒 Průběžné výsledky jsou skryté, zveřejníme je po skončení hlasování.', turnout);
  } else {
    lines.push(
      `✅ **${poll.yes_label}**\n${bar(t.cast ? t.yes / t.cast : 0)}  **${t.pctYes} %** · ${t.yes}`,
      `❌ **${poll.no_label}**\n${bar(t.cast ? t.no / t.cast : 0)}  **${t.pctNo} %** · ${t.no}`,
      ...(poll.abstain ? [`➖ **Zdržel se** · ${t.abstain}`] : []),
      turnout,
    );
  }
  container.addTextDisplayComponents(text(lines.join('\n\n')));

  if (open) {
    container.addSeparatorComponents(divider()).addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(`poll:yes:${poll.id}`, `✅ ${poll.yes_label}`.slice(0, 80), ButtonStyle.Success),
        button(`poll:no:${poll.id}`, `❌ ${poll.no_label}`.slice(0, 80), ButtonStyle.Danger),
        ...(poll.abstain ? [button(`poll:abstain:${poll.id}`, '➖ Zdržuji se')] : []),
      ),
      new ActionRowBuilder().addComponents(button(`poll:peek:${poll.id}`, '📊 Průběžně (tým)'), button(`poll:close:${poll.id}`, '🔒 Ukončit')),
    );
    container.addSeparatorComponents(divider()).addTextDisplayComponents(text(
      `-# 🔐 Hlasování je anonymní: ostatní členové ani moderátoři nevidí, jak jsi hlasoval(a). Hlas můžeš změnit do <t:${ends}:f>, kliknutím na stejnou volbu ho zrušíš.` +
      `${poll.role_id ? ` Hlasovat smějí členové s rolí <@&${poll.role_id}>.` : ''}`,
    ));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

const getPoll = async (id) => (await query('SELECT * FROM polls WHERE id = $1', [id])).rows[0];

/* ---------- Založení ---------- */

// Vstup z příkazu /hlasovani vytvorit: volby si zapamatujeme a otevřeme formulář.
export async function startPollModal(interaction) {
  const o = interaction.options;
  const id = randomBytes(4).toString('hex');
  drafts.set(id, {
    channelId: o.getChannel('kanal')?.id ?? null,
    hours: o.getInteger('trvani_hodin') ?? 72,
    roleId: o.getRole('kdo_hlasuje')?.id ?? null,
    pingId: o.getRole('oznacit')?.id ?? null,
    abstain: o.getBoolean('zdrzet_se') ?? false,
    hide: o.getBoolean('skryt_vysledky') ?? false,
    color: o.getString('barva'),
    publish: o.getBoolean('publikovat') ?? false,
    expires: Date.now() + 15 * 60_000,
  });
  const field = (cid, label, style, extra = {}) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(style).setRequired(extra.required ?? true).setMaxLength(extra.max ?? 100).setPlaceholder(extra.placeholder ?? ''),
  );
  await interaction.showModal(
    new ModalBuilder().setCustomId(`poll:create:${id}`).setTitle('Nové hlasování').addComponents(
      field('title', 'Nadpis oznámení', TextInputStyle.Short, { max: 100, placeholder: 'Např. Jak bude fungovat server dál?' }),
      field('question', 'Otázka k hlasování', TextInputStyle.Short, { max: 200, placeholder: 'Např. Souhlasíš s tímto plánem?' }),
      field('description', 'Text oznámení (vysvětlení, souvislosti)', TextInputStyle.Paragraph, { max: 2500, placeholder: 'Napiš všechno, co lidé potřebují vědět, než se rozhodnou.' }),
      field('yes', 'Text volby ANO (volitelné)', TextInputStyle.Short, { required: false, max: 40, placeholder: 'Výchozí: Ano' }),
      field('no', 'Text volby NE (volitelné)', TextInputStyle.Short, { required: false, max: 40, placeholder: 'Výchozí: Ne' }),
    ),
  );
}

async function createPoll(interaction, draftId) {
  const draft = drafts.get(draftId);
  if (!draft || draft.expires < Date.now()) {
    drafts.delete(draftId);
    return interaction.reply({ content: 'Formulář vypršel. Spusť prosím příkaz /hlasovani vytvorit znovu.', flags: EPHEMERAL });
  }
  drafts.delete(draftId);
  await interaction.deferReply({ flags: EPHEMERAL });

  const f = (id) => interaction.fields.getTextInputValue(id).trim();
  let color = null;
  if (draft.color) {
    const m = /^#?([0-9a-f]{6})$/i.exec(draft.color.trim());
    if (!m) return interaction.editReply('Barvu zadej ve tvaru #C9A227. Spusť příkaz znovu.');
    color = Number.parseInt(m[1], 16);
  }
  const channel = draft.channelId ? await interaction.guild.channels.fetch(draft.channelId).catch(() => null) : interaction.channel;
  if (!channel) return interaction.editReply('Kanál se nepodařilo najít.');

  const { rows: [poll] } = await query(
    `INSERT INTO polls (guild_id, channel_id, creator_id, title, question, description, yes_label, no_label, abstain, role_id, hide_results, color, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + ($13 || ' hours')::interval) RETURNING *`,
    [interaction.guildId, channel.id, interaction.user.id, f('title'), f('question'), f('description'), f('yes') || 'Ano', f('no') || 'Ne', draft.abstain, draft.roleId, draft.hide, color, String(draft.hours)],
  );
  try {
    const eligible = await eligibleCount(interaction.guild, poll.role_id);
    const card = buildPoll(poll, await tally(poll.id), { iconUrl: panelIcon(interaction.guild, interaction.client), eligible });
    const everyone = draft.pingId === interaction.guildId;
    const ping = !draft.pingId ? null : everyone ? '@everyone' : `<@&${draft.pingId}>`;
    const message = await channel.send({
      components: ping ? [text(ping), ...card.components] : card.components,
      flags: card.flags,
      allowedMentions: everyone ? { parse: ['everyone'] } : { roles: draft.pingId ? [draft.pingId] : [] },
    });
    await query('UPDATE polls SET message_id = $1 WHERE id = $2', [message.id, poll.id]);
    if (draft.publish && channel.type === ChannelType.GuildAnnouncement) await message.crosspost().catch((e) => console.error('Publikace hlasování:', e.message));
    await interaction.editReply(`Hlasování je zveřejněné: ${message.url}\nKončí <t:${unix(poll.ends_at)}:f>.`);
  } catch (err) {
    await query('DELETE FROM polls WHERE id = $1', [poll.id]);
    throw err;
  }
}

/* ---------- Hlasování ---------- */

export async function handlePollInteraction(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  if (action === 'create') return createPoll(interaction, arg);
  const id = Number(arg);
  if (action === 'yes' || action === 'no' || action === 'abstain') return castVote(interaction, id, action);
  if (action === 'peek') return peek(interaction, id);
  if (action === 'close') return closeByStaff(interaction, id);
}

async function castVote(interaction, id, choice) {
  const poll = await getPoll(id);
  if (!poll || poll.status !== 'open') return interaction.reply({ content: 'Toto hlasování už skončilo.', flags: EPHEMERAL });
  if (new Date(poll.ends_at).getTime() <= Date.now()) {
    await closePoll(interaction.client, id);
    return interaction.reply({ content: 'Toto hlasování právě skončilo.', flags: EPHEMERAL });
  }
  if (choice === 'abstain' && !poll.abstain) return interaction.reply({ content: 'V tomto hlasování se nejde zdržet.', flags: EPHEMERAL });
  if (poll.role_id && !interaction.member?.roles?.cache?.has(poll.role_id)) {
    return interaction.reply({ content: `Hlasovat smějí jen členové s rolí <@&${poll.role_id}>.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
  }

  const labels = { yes: poll.yes_label, no: poll.no_label, abstain: 'Zdržuji se' };
  const { rows: [existing] } = await query('SELECT choice FROM poll_ballots WHERE poll_id = $1 AND user_id = $2', [id, interaction.user.id]);
  let note;
  if (existing?.choice === choice) {
    await query('DELETE FROM poll_ballots WHERE poll_id = $1 AND user_id = $2', [id, interaction.user.id]);
    note = 'Tvůj hlas je zrušený. Můžeš hlasovat znovu, dokud hlasování běží.';
  } else {
    await query(
      `INSERT INTO poll_ballots (poll_id, user_id, choice) VALUES ($1, $2, $3) ON CONFLICT (poll_id, user_id) DO UPDATE SET choice = $3, voted_at = now()`,
      [id, interaction.user.id, choice],
    );
    note = `${existing ? 'Hlas jsem ti změnil' : 'Díky, hlas je uložený'}: **${labels[choice]}**. Je anonymní. Kliknutím na stejnou volbu ho zrušíš.`;
  }
  const card = buildPoll(poll, await tally(id), { iconUrl: panelIcon(interaction.guild, interaction.client), eligible: await eligibleCount(interaction.guild, poll.role_id) });
  await interaction.update(card);
  await interaction.followUp({ content: note, flags: EPHEMERAL });
}

async function requireStaff(interaction) {
  const settings = await getSettings(interaction.guildId);
  const ok = interaction.memberPermissions?.has(P.Administrator) || (settings.staffRole && interaction.member?.roles?.cache?.has(settings.staffRole));
  if (!ok) await interaction.reply({ content: 'Tohle může jen tým.', flags: EPHEMERAL });
  return Boolean(ok);
}

// Průběžné výsledky pro tým i při skrytých výsledcích (jen počty, nikdy jména).
async function peek(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const poll = await getPoll(id);
  if (!poll) return interaction.reply({ content: 'Hlasování neexistuje.', flags: EPHEMERAL });
  const t = await tally(id);
  const eligible = await eligibleCount(interaction.guild, poll.role_id);
  await interaction.reply({
    content:
      `**Průběžné výsledky (jen pro tým)**\n✅ ${poll.yes_label}: **${t.yes}** (${t.pctYes} %)\n❌ ${poll.no_label}: **${t.no}** (${t.pctNo} %)` +
      `${poll.abstain ? `\n➖ Zdrželo se: **${t.abstain}**` : ''}\n👥 Hlasovalo ${t.voters}${eligible && eligible >= t.voters ? ` z ${eligible}` : ''}`,
    flags: EPHEMERAL,
  });
}

async function closeByStaff(interaction, id) {
  if (!(await requireStaff(interaction))) return;
  const poll = await getPoll(id);
  if (!poll || poll.status !== 'open') return interaction.reply({ content: 'Toto hlasování už skončilo.', flags: EPHEMERAL });
  await interaction.deferUpdate();
  await closePoll(interaction.client, id);
}

/* ---------- Ukončení a vyhlášení výsledku ---------- */

export async function closePoll(client, id) {
  const { rows: [poll] } = await query(`UPDATE polls SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'open' RETURNING *`, [id]);
  if (!poll) return;
  const guild = client.guilds?.cache?.get(poll.guild_id);
  const t = await tally(id);
  const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(poll.message_id).catch(() => null);
  const eligible = guild ? await eligibleCount(guild, poll.role_id) : null;
  await message?.edit(buildPoll(poll, t, { iconUrl: guild ? panelIcon(guild, client) : null, eligible }));

  const result = t.cast === 0 ? 'Nikdo nehlasoval.' : t.yes === t.no ? `Remíza (${t.yes} : ${t.no}).` : t.yes > t.no
    ? `Vítězí **${poll.yes_label}** (${t.pctYes} %, ${hlasu(t.yes)} proti ${t.no}).` : `Vítězí **${poll.no_label}** (${t.pctNo} %, ${hlasu(t.no)} proti ${t.yes}).`;
  await channel?.send({
    content: `📊 **Hlasování skončilo: ${clip(poll.title, 150)}**\n${result}\n👥 Hlasovalo ${t.voters}${eligible && eligible >= t.voters ? ` z ${eligible}` : ''}.`,
    allowedMentions: { parse: [] },
    ...(poll.message_id ? { reply: { messageReference: poll.message_id, failIfNotExists: false } } : {}),
  }).catch((e) => console.error('Výsledek hlasování:', e.message));
  if (guild) scheduleBoardUpdate(client, guild.id, 1000);
}

export function startPollSweeper(client) {
  const run = async () => {
    const { rows } = await query(`SELECT id FROM polls WHERE status = 'open' AND ends_at <= now()`);
    for (const { id } of rows) await closePoll(client, id).catch(console.error);
  };
  run().catch(console.error);
  setInterval(() => run().catch(console.error), 60_000);
}
