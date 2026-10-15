import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { handleStreamCommand } from '../features/streams/index.js';

const platform = (o) => o.setName('platforma').setDescription('Platforma').setRequired(true).addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'Kick', value: 'kick' });

export const data = new SlashCommandBuilder()
  .setName('stream')
  .setDescription('Oznamování streamů (jen správci)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('pridat').setDescription('Přidá streamera, jehož streamy bot oznamuje')
      .addStringOption(platform)
      .addStringOption((o) => o.setName('kanal').setDescription('Název kanálu nebo odkaz').setRequired(true))
      .addUserOption((o) => o.setName('clen').setDescription('Člen serveru, který kanál vlastní (volitelné)')),
  )
  .addSubcommand((s) =>
    s.setName('odebrat').setDescription('Odebere streamera ze seznamu')
      .addStringOption(platform)
      .addStringOption((o) => o.setName('kanal').setDescription('Název kanálu').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('seznam').setDescription('Ukáže sledované streamery'));

export const execute = (interaction) => handleStreamCommand(interaction);
