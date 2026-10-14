import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getSettings, saveSettings } from '../db.js';
import { buildPanel } from '../features/tickets/ui.js';
import { buildRolesPanel } from '../features/roles/ui.js';
import { allRoleDefs } from '../features/roles/data.js';
import { welcomeMember } from '../features/welcome/index.js';
import { buildLfgPanel } from '../features/lfg/ui.js';
import { buildCommunityPanel } from '../features/community/index.js';

const EPHEMERAL = MessageFlags.Ephemeral;

export const data = new SlashCommandBuilder()
  .setName('nastaveni')
  .setDescription('Nastavení bota (jen pro správce)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('tickety').setDescription('Nastaví ticket systém a pošle panel do zvoleného kanálu')
      .addChannelOption((o) => o.setName('panel').setDescription('Kanál, kam se pošle panel Support Center').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((o) => o.setName('kategorie').setDescription('Kategorie, ve které se budou vytvářet tickety').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addChannelOption((o) => o.setName('log').setDescription('Privátní kanál pro týmový log a přepisy').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption((o) => o.setName('moderatori').setDescription('Role, která vidí všechny tickety').setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('role').setDescription('Vytvoří chybějící role a pošle panel pro výběr rolí')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál pro výběr rolí (jiný než přivítání)').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('welcome').setDescription('Nastaví kanál s přivítáním nových členů')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál, kde se zobrazí přivítání').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('lfg').setDescription('Nastaví hledání spoluhráčů a pošle panel do zvoleného kanálu')
      .addChannelOption((o) => o.setName('kanal').setDescription('Společný kanál pro LFG příspěvky').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((o) => o.setName('kategorie').setDescription('Kategorie pro dočasné voice roomky (výchozí: kategorie LFG kanálu)').addChannelTypes(ChannelType.GuildCategory)),
  )
  .addSubcommand((s) =>
    s.setName('komunita').setDescription('Nastaví panel Komunita (profil, nápady, propojení LoL), návrhy a milníky')
      .addChannelOption((o) => o.setName('panel').setDescription('Kanál, kam se pošle panel Komunita').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((o) => o.setName('navrhy').setDescription('Kanál, kam se budou posílat nápady od členů').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((o) => o.setName('milniky').setDescription('Kanál pro oznámení nových milníků (volitelné)').addChannelTypes(ChannelType.GuildText)),
  )
  .addSubcommand((s) =>
    s.setName('lounge').setDescription('Zapne Voice Lounge: vlastní dočasné roomky pro členy')
      .addChannelOption((o) => o.setName('kategorie').setDescription('Kategorie, ve které se budou roomky vytvářet').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addChannelOption((o) => o.setName('vstup').setDescription('Hlasový kanál pro vytvoření roomky (když nevyplníš, bot ho vytvoří)').addChannelTypes(ChannelType.GuildVoice)),
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
  if (sub === 'welcome-test') return testWelcome(interaction);
}

async function setupTickets(interaction) {
  const panel = interaction.options.getChannel('panel', true);
  await saveSettings(interaction.guildId, {
    ticketPanelChannel: panel.id,
    ticketCategory: interaction.options.getChannel('kategorie', true).id,
    ticketLog: interaction.options.getChannel('log', true).id,
    staffRole: interaction.options.getRole('moderatori', true).id,
  });
  await panel.send(buildPanel());
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
  await channel.send(buildRolesPanel());

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
  await channel.send(buildLfgPanel());
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
  await panel.send(buildCommunityPanel());
  await interaction.reply({ content: `Hotovo. Panel Komunita je v ${panel}, nápady se budou posílat do ${suggestions}.`, flags: EPHEMERAL });
}

async function setupLounge(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const category = interaction.options.getChannel('kategorie', true);
  let entry = interaction.options.getChannel('vstup');
  if (!entry) {
    entry = await interaction.guild.channels.create({ name: '〉➕| Vytvořit roomku', type: ChannelType.GuildVoice, parent: category.id });
  }
  await saveSettings(interaction.guildId, { loungeCreator: entry.id, loungeCategory: category.id });
  await interaction.editReply(`Hotovo. Kdo vstoupí do ${entry}, dostane vlastní roomku v kategorii ${category}.`);
}
