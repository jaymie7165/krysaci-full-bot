import { SlashCommandBuilder } from 'discord.js';
import { createLobby, showHistory } from '../features/custom/index.js';

export const data = new SlashCommandBuilder()
  .setName('custom')
  .setDescription('LoL custom hry')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('vytvorit').setDescription('Založí lobby pro LoL custom hru (jen tým)')
      .addStringOption((o) => o.setName('rezim').setDescription('Režim hry').addChoices({ name: '5v5 (Summoner\'s Rift)', value: '5v5' }, { name: 'ARAM', value: 'aram' }))
      .addStringOption((o) => o.setName('poznamka').setDescription('Krátký popis nebo čas, např. dnes 20:00').setMaxLength(150)),
  )
  .addSubcommand((s) =>
    s.setName('historie').setDescription('Historie odehraných custom her')
      .addUserOption((o) => o.setName('hrac').setDescription('Ukáže statistiky tohoto hráče')),
  );

export async function execute(interaction) {
  if (interaction.options.getSubcommand() === 'vytvorit') return createLobby(interaction);
  return showHistory(interaction);
}
