import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { startPollModal } from '../features/polls/index.js';

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const data = new SlashCommandBuilder()
  .setName('hlasovani')
  .setDescription('Hlasování Ano/Ne s velkým oznámením (jen správci)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('vytvorit').setDescription('Založí hlasování Ano/Ne jako velké oznámení')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kam se hlasování zveřejní (výchozí: aktuální kanál)').addChannelTypes(...TEXT_CHANNELS))
      .addIntegerOption((o) => o.setName('trvani_hodin').setDescription('Jak dlouho hlasování běží (výchozí 72 hodin)').setMinValue(1).setMaxValue(720))
      .addRoleOption((o) => o.setName('kdo_hlasuje').setDescription('Hlasovat smí jen členové s touto rolí (výchozí: všichni)'))
      .addRoleOption((o) => o.setName('oznacit').setDescription('Role (nebo @everyone), která se při zveřejnění označí'))
      .addBooleanOption((o) => o.setName('zdrzet_se').setDescription('Přidat třetí volbu „Zdržuji se“'))
      .addBooleanOption((o) => o.setName('skryt_vysledky').setDescription('Skrýt průběžné výsledky až do konce hlasování'))
      .addStringOption((o) => o.setName('barva').setDescription('Barva pruhu oznámení ve tvaru #C9A227').setMaxLength(7))
      .addBooleanOption((o) => o.setName('publikovat').setDescription('V oznamovacím kanálu zprávu rovnou publikovat sledujícím serverům')),
  );

export const execute = (interaction) => startPollModal(interaction);
