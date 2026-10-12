import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { saveSettings } from '../db.js';
import { buildPanel } from '../features/tickets/ui.js';

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
  );

export async function execute(interaction) {
  if (interaction.options.getSubcommand() === 'tickety') {
    const panel = interaction.options.getChannel('panel', true);
    await saveSettings(interaction.guildId, {
      ticketPanelChannel: panel.id,
      ticketCategory: interaction.options.getChannel('kategorie', true).id,
      ticketLog: interaction.options.getChannel('log', true).id,
      staffRole: interaction.options.getRole('moderatori', true).id,
    });
    await panel.send(buildPanel());
    await interaction.reply({ content: `Hotovo. Panel je v ${panel}.`, flags: MessageFlags.Ephemeral });
  }
}
