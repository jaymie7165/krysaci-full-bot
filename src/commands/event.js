import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { showCreateEventModal } from '../features/events/index.js';

// Kanály, do kterých bot smí psát: textové i oznamovací.
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Eventy (jen správci)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('vytvorit').setDescription('Založí event s přihláškami a připomínkou')
      .addRoleOption((o) => o.setName('role').setDescription('Role, která se označí při zveřejnění'))
      .addBooleanOption((o) => o.setName('publikovat').setDescription('V oznamovacím kanálu zprávu rovnou publikovat sledujícím serverům'))
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanál pro event (výchozí: aktuální)').addChannelTypes(...TEXT_CHANNELS)),
  );

export const execute = (interaction) => showCreateEventModal(interaction);
