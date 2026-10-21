import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getSettings, saveSettings } from '../db.js';
import { buildPanel, panelIcon } from '../features/tickets/ui.js';
import { buildRolesPanel } from '../features/roles/ui.js';
import { allRoleDefs } from '../features/roles/data.js';
import { welcomeMember } from '../features/welcome/index.js';
import { buildLfgPanel } from '../features/lfg/ui.js';
import { buildCardsPanel } from '../features/cards/index.js';
import { buildBoard } from '../features/tonight/board.js';
import { buildCommunityPanel } from '../features/community/index.js';
import { createStatsChannels } from '../features/stats/index.js';
import { BAR } from '../theme.js';
import { backfillBaseRole, canAssign, ensureRole, parseColor } from '../features/baserole/index.js';

const EPHEMERAL = MessageFlags.Ephemeral;

// Kanály, do kterých bot smí psát: textové i oznamovací.
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const data = new SlashCommandBuilder()
  .setName('nastaveni')
  .setDescription('Nastavení bota (jen pro správce)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('tickety').setDescription('Nastaví ticket systém a pošle panel do zvoleného kanálu')
      .addChannelOption((o) => o.setName('panel').setDescription('Kanál, kam se pošle panel Support Center').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addChannelOption((o) => o.setName('kategorie').setDescription('Kategorie, ve které se budou vytvářet tickety').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addChannelOption((o) => o.setName('log').setDescription('Privátní kanál pro týmový log a přepisy').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addRoleOption((o) => o.setName('moderatori').setDescription('Role, která vidí všechny tickety').setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('role').setDescription('Vytvoří chybějící role a pošle panel pro výběr rolí')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál pro výběr rolí (jiný než přivítání)').addChannelTypes(...TEXT_CHANNELS).setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('welcome').setDescription('Nastaví kanál s přivítáním nových členů')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál, kde se zobrazí přivítání').addChannelTypes(...TEXT_CHANNELS).setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('lfg').setDescription('Nastaví hledání spoluhráčů a pošle panel do zvoleného kanálu')
      .addChannelOption((o) => o.setName('kanal').setDescription('Společný kanál pro LFG příspěvky').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addChannelOption((o) => o.setName('kategorie').setDescription('Kategorie pro dočasné voice roomky (výchozí: kategorie LFG kanálu)').addChannelTypes(ChannelType.GuildCategory)),
  )
  .addSubcommand((s) =>
    s.setName('komunita').setDescription('Nastaví panel Komunita (profil, nápady, propojení LoL), návrhy a milníky')
      .addChannelOption((o) => o.setName('panel').setDescription('Kanál, kam se pošle panel Komunita').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addChannelOption((o) => o.setName('navrhy').setDescription('Kanál, kam se budou posílat nápady od členů').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addChannelOption((o) => o.setName('milniky').setDescription('Kanál pro oznámení nových milníků (volitelné)').addChannelTypes(...TEXT_CHANNELS)),
  )
  .addSubcommand((s) =>
    s.setName('lounge').setDescription('Zapne Voice Lounge: vlastní dočasné roomky pro členy')
      .addChannelOption((o) => o.setName('kategorie').setDescription('Kategorie, ve které se budou roomky vytvářet').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addChannelOption((o) => o.setName('vstup').setDescription('Hlasový kanál pro vytvoření roomky (když nevyplníš, bot ho vytvoří)').addChannelTypes(ChannelType.GuildVoice)),
  )
  .addSubcommand((s) =>
    s.setName('statistiky').setDescription('Vytvoří kanály s počtem členů a botů')
      .addChannelOption((o) => o.setName('kategorie').setDescription('Kategorie pro statistiky (když nevyplníš, bot vytvoří 📊 STATS)').addChannelTypes(ChannelType.GuildCategory)),
  )
  .addSubcommand((s) =>
    s.setName('stream').setDescription('Nastaví kanál pro oznámení streamů')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál, kam se budou oznamovat streamy').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role, která se označí při zahájení streamu (volitelné)')),
  )
  .addSubcommand((s) =>
    s.setName('streamer').setDescription('Nastaví roli streamera, kterou tým uděluje po schválení žádosti v ticketu')
      .addRoleOption((o) => o.setName('role').setDescription('Role streamera (když nevyplníš, bot vytvoří roli Streamer)')),
  )
  .addSubcommand((s) =>
    s.setName('mys').setDescription('Vytvoří roli Myš a přidělí ji všem členům i každému novému')
      .addRoleOption((o) => o.setName('role').setDescription('Použít existující roli místo vytvoření nové'))
      .addStringOption((o) => o.setName('barva').setDescription('Barva nové role ve tvaru #E8A5B9').setMaxLength(7)),
  )
  .addSubcommand((s) =>
    s.setName('modlog').setDescription('Nastaví kanál, kam se zapisují všechny zásahy moderátorů')
      .addChannelOption((o) => o.setName('kanal').setDescription('Privátní kanál pro tým').addChannelTypes(...TEXT_CHANNELS).setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('get2know').setDescription('Nastaví kanál Get2know: panel a veřejné vizitky členů')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál get2know').addChannelTypes(...TEXT_CHANNELS).setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('dnesvecer').setDescription('Zapne přehled Dnes večer a spontánní „Hrajeme?“ v jednom kanálu')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál, kde bude přehled a otázky Hrajeme?').addChannelTypes(...TEXT_CHANNELS).setRequired(true)),
  )
  .addSubcommand((s) => s.setName('welcome-test').setDescription('Vyzkouší přivítání na tobě'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'tickety') return setupTickets(interaction);
  if (sub === 'role') return setupRoles(interaction);
  if (sub === 'welcome') return setupWelcome(interaction);
  if (sub === 'lfg') return setupLfg(interaction);
  if (sub === 'komunita') return setupCommunity(interaction);
  if (sub === 'lounge') return setupLounge(interaction);
  if (sub === 'statistiky') return setupStats(interaction);
  if (sub === 'stream') return setupStream(interaction);
  if (sub === 'streamer') return setupStreamerRole(interaction);
  if (sub === 'mys') return setupBaseRole(interaction);
  if (sub === 'modlog') return setupModLog(interaction);
  if (sub === 'get2know') return setupCards(interaction);
  if (sub === 'dnesvecer') return setupTonight(interaction);
  if (sub === 'welcome-test') return testWelcome(interaction);
}

async function setupTickets(interaction) {
  const panel = interaction.options.getChannel('panel', true);
  const previous = await getSettings(interaction.guildId);

  // Starý panel (pokud ho bot zná) se smaže, aby v kanálu nezůstaly dva.
  if (previous.ticketPanelChannel && previous.ticketPanelMessage) {
    const oldChannel = await interaction.guild.channels.fetch(previous.ticketPanelChannel).catch(() => null);
    await oldChannel?.messages.delete(previous.ticketPanelMessage).catch(() => {});
  }
  const message = await panel.send(buildPanel({ iconUrl: panelIcon(interaction.guild, interaction.client) }));
  await saveSettings(interaction.guildId, {
    ticketPanelChannel: panel.id,
    ticketPanelMessage: message.id,
    ticketCategory: interaction.options.getChannel('kategorie', true).id,
    ticketLog: interaction.options.getChannel('log', true).id,
    staffRole: interaction.options.getRole('moderatori', true).id,
  });
  await interaction.reply({ content: `Hotovo. Panel je v ${panel}.`, flags: EPHEMERAL });
}

async function setupRoles(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const guild = interaction.guild;
  const channel = interaction.options.getChannel('kanal', true);
  await guild.roles.fetch();

  const settings = await getSettings(guild.id);
  const map = { ...(settings.roleMap ?? {}) };
  let created = 0;
  let found = 0;

  // Použije existující roli se stejným názvem, jinak ji vytvoří.
  for (const def of allRoleDefs()) {
    let role = map[def.key] && guild.roles.cache.get(map[def.key]);
    if (!role) role = guild.roles.cache.find((r) => r.name.toLowerCase() === def.name.toLowerCase() && !r.managed);
    if (role) found++;
    else {
      role = await guild.roles.create({ name: def.name, mentionable: false, reason: 'Role pro výběr členů' });
      created++;
    }
    map[def.key] = role.id;
  }

  await saveSettings(guild.id, { roleMap: map, rolesChannel: channel.id });
  await replacePanel(interaction, 'roles', channel, buildRolesPanel({ iconUrl: panelIcon(guild, interaction.client) }));

  // Bot nemůže přidělovat role, které jsou v hierarchii nad ním.
  const top = guild.members.me.roles.highest;
  const blocked = Object.values(map)
    .map((id) => guild.roles.cache.get(id))
    .filter((r) => r && r.comparePositionTo(top) >= 0)
    .map((r) => r.name);

  let msg = `Hotovo. Vytvořeno rolí: **${created}**, použito existujících: **${found}**. Panel je v ${channel}.`;
  if (blocked.length) {
    msg += `\n\nPozor, tyto role jsou nad rolí bota a nepůjdou přidělit: ${blocked.join(', ')}. Přetáhni v Nastavení serveru → Role roli bota výš.`;
  }
  await interaction.editReply(msg);
}

async function setupWelcome(interaction) {
  const channel = interaction.options.getChannel('kanal', true);
  await saveSettings(interaction.guildId, { welcomeChannel: channel.id });
  await interaction.reply({ content: `Hotovo. Noví členové budou přivítáni v ${channel}.`, flags: EPHEMERAL });
}

async function testWelcome(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const result = await welcomeMember(interaction.member);
  const lines = [
    `Zpráva v kanálu: ${result.channel ? 'odeslána' : 'neodeslána (nastav kanál příkazem /nastaveni welcome)'}`,
    `DM: ${result.dm ? 'odesláno' : 'nelze doručit (máš zavřené DM od členů serveru?)'}`,
  ];
  await interaction.editReply(lines.join('\n'));
}

async function setupLfg(interaction) {
  const channel = interaction.options.getChannel('kanal', true);
  const category = interaction.options.getChannel('kategorie');
  await saveSettings(interaction.guildId, { lfgChannel: channel.id, lfgCategory: category?.id ?? null });
  await replacePanel(interaction, 'lfg', channel, buildLfgPanel({ iconUrl: panelIcon(interaction.guild, interaction.client) }));
  await interaction.reply({ content: `Hotovo. Panel pro hledání spoluhráčů je v ${channel}. Příkaz /lfg funguje kdekoli.`, flags: EPHEMERAL });
}

async function setupCommunity(interaction) {
  const panel = interaction.options.getChannel('panel', true);
  const suggestions = interaction.options.getChannel('navrhy', true);
  const achievements = interaction.options.getChannel('milniky');
  await saveSettings(interaction.guildId, {
    suggestionChannel: suggestions.id,
    achievementChannel: achievements?.id ?? null,
  });
  await replacePanel(interaction, 'community', panel, buildCommunityPanel({ iconUrl: panelIcon(interaction.guild, interaction.client) }));
  await interaction.reply({ content: `Hotovo. Panel Komunita je v ${panel}, nápady se budou posílat do ${suggestions}.`, flags: EPHEMERAL });
}

async function setupLounge(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const category = interaction.options.getChannel('kategorie', true);
  let entry = interaction.options.getChannel('vstup');
  if (!entry) {
    entry = await interaction.guild.channels.create({ name: `〉➕${BAR} Vytvořit roomku`, type: ChannelType.GuildVoice, parent: category.id });
  }
  await saveSettings(interaction.guildId, { loungeCreator: entry.id, loungeCategory: category.id });
  await interaction.editReply(`Hotovo. Kdo vstoupí do ${entry}, dostane vlastní roomku v kategorii ${category}.`);
}

async function setupStats(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const { parent, membersChannel, botsChannel } = await createStatsChannels(interaction.guild, interaction.options.getChannel('kategorie'));
  await saveSettings(interaction.guildId, { statsMembers: membersChannel.id, statsBots: botsChannel.id });
  await interaction.editReply(`Hotovo. Statistiky jsou v kategorii ${parent}. Čísla se aktualizují sama, nejdéle do 10 minut.`);
}

async function setupStream(interaction) {
  const channel = interaction.options.getChannel('kanal', true);
  const role = interaction.options.getRole('role');
  await saveSettings(interaction.guildId, { streamChannel: channel.id, streamRole: role?.id ?? null });
  await interaction.reply({ content: `Hotovo. Streamy se budou oznamovat v ${channel}. Streamery přidáš příkazem /stream pridat.`, flags: EPHEMERAL });
}

async function setupStreamerRole(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const guild = interaction.guild;
  let role = interaction.options.getRole('role');
  if (!role) {
    await guild.roles.fetch();
    role = guild.roles.cache.find((r) => r.name.toLowerCase() === 'streamer' && !r.managed)
      ?? await guild.roles.create({ name: 'Streamer', reason: 'Role streamera' });
  }
  await saveSettings(interaction.guildId, { streamerRole: role.id });
  const blocked = role.comparePositionTo(guild.members.me.roles.highest) >= 0;
  await interaction.editReply(
    `Hotovo. Roli streamera ${role} bude tým udělovat tlačítkem Schválit streamera v ticketu.` +
    (blocked ? '\n\nPozor, role je nad rolí bota a nepůjde přidělit. Přetáhni v Nastavení serveru → Role roli bota výš.' : ''),
  );
}

async function setupBaseRole(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const guild = interaction.guild;
  const colorInput = interaction.options.getString('barva');
  const color = colorInput ? parseColor(colorInput) : null;
  if (colorInput && color === null) return interaction.editReply('Barvu zadej ve tvaru #E8A5B9.');

  const { role, created } = await ensureRole(guild, { role: interaction.options.getRole('role'), color });
  if (!canAssign(guild, role)) {
    return interaction.editReply(
      `Roli ${role} bot nemůže přidělovat, je nad jeho rolí. Přetáhni v Nastavení serveru → Role roli bota **nad** ni a spusť příkaz znovu.`,
    );
  }
  await saveSettings(interaction.guildId, { baseRole: role.id });
  const edit = (text) => interaction.editReply(text).catch(() => {});
  await edit(`Role ${role} je ${created ? 'vytvořená' : 'nastavená'}. Přiděluju ji členům, může to trvat pár minut. Noví členové ji budou dostávat automaticky.`);

  try {
    const r = await backfillBaseRole(guild, role.id, (p) => edit(`Přiděluju roli ${role}: ${p.done} z ${p.total}`));
    await edit(
      `Hotovo. Roli ${role} jsem přidělil **${r.added}** členům, **${r.had}** ji už mělo.` +
      (r.failed ? `\nNepodařilo se u **${r.failed}** členů (pravděpodobně už odešli).` : '') +
      `\nBoti ji nedostávají. Noví členové ji dostanou sami.`,
    );
  } catch (err) {
    if (err.message === 'missing-permissions') {
      await edit(`Bot nemá oprávnění tuto roli přidělit. Zkontroluj, že má oprávnění Spravovat role a že je jeho role nad rolí ${role}.`);
    } else {
      console.error(err);
      await edit('Přidělování se přerušilo kvůli chybě. Spusť příkaz znovu, kdo roli už má, bude přeskočen.');
    }
  }
}

// Smaže dříve zveřejněný panel (pokud ho bot zná) a pošle nový, ať se v kanálech nehromadí duplicity.
async function replacePanel(interaction, key, channel, payload) {
  const panels = (await getSettings(interaction.guildId)).panels ?? {};
  const old = panels[key];
  if (old) {
    const oldChannel = await interaction.guild.channels.fetch(old.channel).catch(() => null);
    await oldChannel?.messages.delete(old.message).catch(() => {});
  }
  const message = await channel.send(payload);
  await saveSettings(interaction.guildId, { panels: { ...panels, [key]: { channel: channel.id, message: message.id } } });
  return message;
}

async function setupModLog(interaction) {
  const channel = interaction.options.getChannel('kanal', true);
  await saveSettings(interaction.guildId, { modLog: channel.id });
  await interaction.reply({ content: `Hotovo. Zásahy moderátorů se budou zapisovat do ${channel}.`, flags: EPHEMERAL });
}

async function setupCards(interaction) {
  const channel = interaction.options.getChannel('kanal', true);
  await saveSettings(interaction.guildId, { cardChannel: channel.id });
  await replacePanel(interaction, 'cards', channel, buildCardsPanel({ iconUrl: panelIcon(interaction.guild, interaction.client) }));
  await interaction.reply({ content: `Hotovo. Panel Get2know je v ${channel}, vizitky členů se budou zveřejňovat tam.`, flags: EPHEMERAL });
}

async function setupTonight(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const channel = interaction.options.getChannel('kanal', true);
  await saveSettings(interaction.guildId, { tonightChannel: channel.id });
  await replacePanel(interaction, 'tonight', channel, await buildBoard(interaction.guild, interaction.client));
  await interaction.editReply(`Hotovo. Přehled Dnes večer je v ${channel}. Otázky „Hrajeme?“ se budou zveřejňovat tam a přehled se sám aktualizuje.`);
}
