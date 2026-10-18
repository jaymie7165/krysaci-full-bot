import { ApplicationCommandType, ContextMenuCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { openModPanel } from '../features/moderation/index.js';

// Pravý klik na člena → Aplikace → Moderace
export const data = new ContextMenuCommandBuilder()
  .setName('Moderace')
  .setType(ApplicationCommandType.User)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export const execute = (interaction) => openModPanel(interaction);
