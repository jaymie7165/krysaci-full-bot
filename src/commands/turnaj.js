import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createTournament } from '../features/tournaments/index.js';

export const data = new SlashCommandBuilder()
  .setName('turnaj')
  .setDescription('Turnaje (jen správci)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('vytvorit').setDescription('Založí turnaj s přihláškami jednotlivců')
      .addStringOption((o) => o.setName('nazev').setDescription('Název turnaje').setRequired(true).setMaxLength(60))
      .addStringOption((o) => o.setName('format').setDescription('Formát turnaje').addChoices({ name: 'Pavouk (vyřazovací)', value: 'pavouk' }, { name: 'Liga (každý s každým)', value: 'liga' }))
      .addIntegerOption((o) => o.setName('max_hracu').setDescription('Maximum přihlášených hráčů (výchozí 40)').setMinValue(10).setMaxValue(80))
      .addRoleOption((o) => o.setName('role').setDescription('Role, která se označí při zveřejnění')),
  );

export const execute = (interaction) => createTournament(interaction);
