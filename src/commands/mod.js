import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { modCommand } from '../features/moderation/index.js';

export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderace (jen tým)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('historie').setDescription('Ukáže historii zásahů u člena')
      .addUserOption((o) => o.setName('clen').setDescription('Člen').setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName('unban').setDescription('Zruší ban')
      .addUserOption((o) => o.setName('uzivatel').setDescription('Uživatel, kterému se ban ruší').setRequired(true))
      .addStringOption((o) => o.setName('duvod').setDescription('Důvod (volitelné)').setMaxLength(300)),
  );

export const execute = (interaction) => modCommand(interaction);
