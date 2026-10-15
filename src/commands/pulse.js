import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createPulse } from '../features/pulse/index.js';

export const data = new SlashCommandBuilder()
  .setName('pulse')
  .setDescription('Hlasování komunity (jen správci)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('vytvorit').setDescription('Založí hlasování, co se bude hrát')
      .addStringOption((o) => o.setName('otazka').setDescription('Otázka (výchozí: Co budeme hrát o víkendu?)').setMaxLength(120))
      .addIntegerOption((o) => o.setName('trvani_hodin').setDescription('Jak dlouho hlasování běží (výchozí 48 hodin)').setMinValue(1).setMaxValue(168))
      .addRoleOption((o) => o.setName('role').setDescription('Role, která se označí při zveřejnění')),
  );

export const execute = (interaction) => createPulse(interaction);
