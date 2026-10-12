import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { initDb } from './db.js';
import { commands } from './commands/index.js';
import { handleTicketInteraction } from './features/tickets/index.js';

const client = new Client({
  // MessageContent je potřeba pro přepisy ticketů (zapni ho v Developer Portalu).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (c) => {
  const rest = new REST().setToken(config.token);
  await rest.put(Routes.applicationGuildCommands(c.user.id, config.guildId), {
    body: [...commands.values()].map((cmd) => cmd.data.toJSON()),
  });
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
  } catch (err) {
    console.error(err);
    const payload = { content: 'Něco se pokazilo. Zkus to prosím znovu, případně kontaktuj správce.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

await initDb();
await client.login(config.token);
