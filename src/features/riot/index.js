import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { colors } from '../../theme.js';
import { RANKS } from '../roles/data.js';
import { checkAchievements } from '../achievements/index.js';
import { RiotError, TIERS, getAccount, getIconId, getSoloRank, hasKey, iconUrl } from './api.js';

const EPHEMERAL = MessageFlags.Ephemeral;

export async function handleRiotInteraction(interaction) {
  const action = interaction.customId.split(':')[1];
  if (action === 'link') return showLinkModal(interaction);
  if (action === 'linkmodal') return startLink(interaction);
  if (action === 'verify') return verifyLink(interaction);
}

const errorText = (err) => {
  if (err instanceof RiotError) {
    if (err.status === 403 || err.status === 401) return 'Riot API klíč není platný nebo vypršel. Napiš prosím správci serveru.';
    if (err.status === 429) return 'Riot API je teď přetížené. Zkus to za chvíli.';
  }
  console.error(err);
  return 'Spojení s Riot API se nepodařilo. Zkus to prosím později.';
};

async function showLinkModal(interaction) {
  if (!hasKey()) {
    return interaction.reply({ content: 'Propojení s Riot API zatím není zapnuté.', flags: EPHEMERAL });
  }
  const input = new TextInputBuilder()
    .setCustomId('riotid').setLabel('Riot ID (Nick#TAG)').setStyle(TextInputStyle.Short)
    .setPlaceholder('Např. Hrac#EUNE').setRequired(true).setMaxLength(40);
  await interaction.showModal(new ModalBuilder().setCustomId('riot:linkmodal').setTitle('Propojení LoL účtu').addComponents(new ActionRowBuilder().addComponents(input)));
}

async function startLink(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const raw = interaction.fields.getTextInputValue('riotid').trim();
  const hash = raw.lastIndexOf('#');
  if (hash < 1 || hash === raw.length - 1) return interaction.editReply('Zadej Riot ID ve tvaru Nick#TAG.');

  try {
    const account = await getAccount(raw.slice(0, hash).trim(), raw.slice(hash + 1).trim());
    if (!account) return interaction.editReply('Tento účet jsem nenašel. Zkontroluj nick a tag.');

    const { rows: taken } = await query(
      'SELECT 1 FROM riot_links WHERE guild_id = $1 AND puuid = $2 AND verified AND user_id <> $3',
      [interaction.guildId, account.puuid, interaction.user.id],
    );
    if (taken.length) return interaction.editReply('Tento účet je už propojený s jiným členem.');

    // Ověření vlastnictví: člen si na chvíli nastaví náhodnou základní ikonu profilu.
    const current = await getIconId(account.puuid);
    const choices = Array.from({ length: 29 }, (_, i) => i).filter((i) => i !== current);
    const icon = choices[Math.floor(Math.random() * choices.length)];
    await query(
      `INSERT INTO riot_links (guild_id, user_id, puuid, riot_id, pending_icon) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET puuid = $3, riot_id = $4, verified = false, pending_icon = $5,
         tier = NULL, division = NULL, rank_idx = NULL, updated_at = now()`,
      [interaction.guildId, interaction.user.id, account.puuid, `${account.gameName}#${account.tagLine}`, icon],
    );

    const url = await iconUrl(icon);
    const embed = new EmbedBuilder().setColor(colors.accent).setTitle('Ověření účtu')
      .setDescription(
        `Našel jsem účet **${account.gameName}#${account.tagLine}**.\n\n` +
        'Aby bylo jisté, že je tvůj, nastav si v League of Legends na chvíli **profilovou ikonu z obrázku níže** ' +
        '(Profil → klik na ikonu → Ikony profilu). Pak klikni na Ověřit. Ikonu si potom můžeš vrátit.',
      );
    if (url) embed.setImage(url);
    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('riot:verify').setLabel('Ověřit').setStyle(ButtonStyle.Success))],
    });
  } catch (err) {
    await interaction.editReply(errorText(err));
  }
}

async function verifyLink(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const { rows: [link] } = await query('SELECT * FROM riot_links WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, interaction.user.id]);
  if (!link) return interaction.editReply('Nejdřív zadej Riot ID tlačítkem Propojit LoL účet.');
  if (link.verified) return interaction.editReply(`Účet **${link.riot_id}** už je ověřený.`);

  try {
    const icon = await getIconId(link.puuid);
    if (icon !== link.pending_icon) {
      return interaction.editReply('Ikona zatím nesedí. Změna se v API někdy projeví se zpožděním, zkus to za chvíli znovu.');
    }
    await query('UPDATE riot_links SET verified = true, pending_icon = NULL, updated_at = now() WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, interaction.user.id]);
    const idx = await syncRank(interaction.guild, interaction.user.id).catch(() => null);
    await interaction.editReply(
      `Hotovo, účet **${link.riot_id}** je propojený.` +
      (idx != null ? ` Tvůj rank **${RANKS.lol[idx]}** jsem nastavil.` : ' Rank (Solo/Duo) jsem nenašel, můžeš si ho zvolit ručně v kanálu pro role.'),
    );
    checkAchievements(interaction.client, interaction.guildId, interaction.user.id);
  } catch (err) {
    await interaction.editReply(errorText(err));
  }
}

// Zjistí aktuální rank z Riot API a promítne ho do LoL rank role. Vrací index ranku, nebo null.
export async function syncRank(guild, userId) {
  if (!hasKey()) return null;
  const { rows: [link] } = await query('SELECT * FROM riot_links WHERE guild_id = $1 AND user_id = $2 AND verified', [guild.id, userId]);
  if (!link) return null;

  const rank = await getSoloRank(link.puuid);
  if (!rank) return link.rank_idx ?? null;
  const idx = TIERS.indexOf(rank.tier);
  await query('UPDATE riot_links SET tier = $3, division = $4, rank_idx = $5, updated_at = now() WHERE guild_id = $1 AND user_id = $2', [guild.id, userId, rank.tier, rank.division, idx]);

  const map = (await getSettings(guild.id)).roleMap;
  const member = map && idx >= 0 ? await guild.members.fetch(userId).catch(() => null) : null;
  if (member) {
    const all = RANKS.lol.map((_, i) => map[`rank:lol:${i}`]).filter(Boolean);
    const want = map[`rank:lol:${idx}`];
    const remove = all.filter((id) => id !== want && member.roles.cache.has(id));
    const add = [want, map['game:lol']].filter((id) => id && !member.roles.cache.has(id));
    if (remove.length) await member.roles.remove(remove).catch(() => {});
    if (add.length) await member.roles.add(add).catch(() => {});
  }
  return idx;
}
