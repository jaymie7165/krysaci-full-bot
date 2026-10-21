import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { initDb } from './db.js';
import { commands } from './commands/index.js';
import { handleTicketInteraction } from './features/tickets/index.js';
import { handleRolesInteraction } from './features/roles/index.js';
import { onMemberAdd } from './features/welcome/index.js';
import { handleLfgInteraction, startLfgSweeper } from './features/lfg/index.js';
import { handleCustomInteraction, startCustomSweeper } from './features/custom/index.js';
import { handleRiotInteraction } from './features/riot/index.js';
import { handleCommunityInteraction } from './features/community/index.js';
import { handleSuggestionInteraction } from './features/community/suggestions.js';
import { handleEventInteraction, startEventSweeper } from './features/events/index.js';
import { handleTournamentInteraction } from './features/tournaments/index.js';
import { cleanupLounges, handleLoungeInteraction, onVoiceStateUpdate } from './features/lounge/index.js';
import { handlePulseInteraction, startPulseSweeper } from './features/pulse/index.js';
import { startStreamPoller } from './features/streams/index.js';
import { scheduleStatsUpdate, startStatsSweeper } from './features/stats/index.js';
import { assignBaseRole } from './features/baserole/index.js';
import { handleModInteraction } from './features/moderation/index.js';
import { handleCardInteraction } from './features/cards/index.js';
import { handleTonightInteraction, startHrajemeSweeper } from './features/tonight/index.js';
import { scheduleBoardUpdate, startBoardUpdater } from './features/tonight/board.js';

const client = new Client({
  // MessageContent je potřeba pro přepisy ticketů (zapni ho v Developer Portalu).
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // Voice Lounge
    GatewayIntentBits.GuildMembers, // vítání nových členů (zapni Server Members Intent v Developer Portalu)
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  const rest = new REST().setToken(config.token);
  await rest.put(Routes.applicationGuildCommands(c.user.id, config.guildId), {
    body: [...commands.values()].map((cmd) => cmd.data.toJSON()),
  });
  startLfgSweeper(c);
  startCustomSweeper(c);
  startEventSweeper(c);
  cleanupLounges(c).catch(console.error);
  startPulseSweeper(c);
  startHrajemeSweeper(c);
  startBoardUpdater(c);
  startStreamPoller(c);
  startStatsSweeper(c);
  console.log(`Bot běží jako ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() || interaction.isUserContextMenuCommand()) {
      await commands.get(interaction.commandName)?.execute(interaction);
      return;
    }
    const feature = interaction.customId?.split(':')[0];
    if (feature === 'ticket') await handleTicketInteraction(interaction);
    else if (feature === 'roles') await handleRolesInteraction(interaction);
    else if (feature === 'lfg') await handleLfgInteraction(interaction);
    else if (feature === 'custom') await handleCustomInteraction(interaction);
    else if (feature === 'riot') await handleRiotInteraction(interaction);
    else if (feature === 'community') await handleCommunityInteraction(interaction);
    else if (feature === 'sug') await handleSuggestionInteraction(interaction);
    else if (feature === 'event') await handleEventInteraction(interaction);
    else if (feature === 'tour') await handleTournamentInteraction(interaction);
    else if (feature === 'mod') await handleModInteraction(interaction);
    else if (feature === 'card') await handleCardInteraction(interaction);
    else if (feature === 'tonight' || feature === 'hr') await handleTonightInteraction(interaction);
    else if (feature === 'lounge') await handleLoungeInteraction(interaction);
    else if (feature === 'pulse') await handlePulseInteraction(interaction);
  } catch (err) {
    console.error(err);
    const payload = { content: 'Něco se pokazilo. Zkus to prosím znovu, případně kontaktuj správce.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  scheduleBoardUpdate(newState.client, newState.guild.id, 15_000);
  onVoiceStateUpdate(oldState, newState).catch(console.error);
});
client.on(Events.GuildMemberAdd, (member) => {
  scheduleStatsUpdate(member.guild);
  assignBaseRole(member).catch(console.error);
  onMemberAdd(member).catch(console.error);
});
client.on(Events.GuildMemberRemove, (member) => scheduleStatsUpdate(member.guild));

await initDb();
await client.login(config.token);
