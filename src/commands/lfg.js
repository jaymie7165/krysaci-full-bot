import { SlashCommandBuilder } from 'discord.js';
import { startLfg } from '../features/lfg/index.js';

export const data = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Založí hledání spoluhráčů')
  .setDMPermission(false);

export const execute = (interaction) => startLfg(interaction);
