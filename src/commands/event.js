import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { showCreateEventModal } from '../features/events/index.js';

export const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Eventy (jen správci)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('vytvorit').setDescription('Založí event s přihláškami a připomínkou')
      .addRoleOption((o) => o.setName('role').setDescription('Role, která se označí při zveřejnění'))
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál pro event (výchozí: aktuální)').addChannelTypes(ChannelType.GuildText)),
  );

export const execute = (interaction) => showCreateEventModal(interaction);
