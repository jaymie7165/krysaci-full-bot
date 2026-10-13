import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { initDb } from './db.js';
import { commands } from './commands/index.js';
import { handleTicketInteraction } from './features/tickets/index.js';
import { handleRolesInteraction } from './features/roles/index.js';
import { onMemberAdd } from './features/welcome/index.js';
import { handleLfgInteraction, startLfgSweeper } from './features/lfg/index.js';

const client = new Client({
  // MessageContent je potřeba pro přepisy ticketů (zapni ho v Developer Portalu).
  intents: [
    GatewayIntentBits.Guilds,
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
  console.log(`Bot běží jako ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await commands.get(interaction.commandName)?.execute(interaction);
      return;
    }
    const feature = interaction.customId?.split(':')[0];
    if (feature === 'ticket') await handleTicketInteraction(interaction);
    else if (feature === 'roles') await handleRolesInteraction(interaction);
    else if (feature === 'lfg') await handleLfgInteraction(interaction);
  } catch (err) {
    console.error(err);
    const payload = { content: 'Něco se pokazilo. Zkus to prosím znovu, případně kontaktuj správce.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, (member) => onMemberAdd(member).catch(console.error));

await initDb();
await client.login(config.token);
