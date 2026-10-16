import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { cleanupOrphans, createLobby, showHistory } from '../features/custom/index.js';

export const data = new SlashCommandBuilder()
  .setName('custom')
  .setDescription('LoL custom hry (jen správci)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('vytvorit').setDescription('Založí lobby pro LoL custom hru (jen tým)')
      .addStringOption((o) => o.setName('rezim').setDescription('Režim hry').addChoices({ name: '5v5 (Summoner\'s Rift)', value: '5v5' }, { name: 'ARAM', value: 'aram' }))
      .addStringOption((o) => o.setName('poznamka').setDescription('Krátký popis nebo čas, např. dnes 20:00').setMaxLength(150)),
  )
  .addSubcommand((s) => s.setName('uklidit').setDescription('Smaže prázdné zapomenuté roomky Blue/Red Side'))
  .addSubcommand((s) =>
    s.setName('historie').setDescription('Historie odehraných custom her')
      .addUserOption((o) => o.setName('hrac').setDescription('Ukáže statistiky tohoto hráče')),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'vytvorit') return createLobby(interaction);
  if (sub === 'uklidit') return cleanupOrphans(interaction);
  return showHistory(interaction);
}
