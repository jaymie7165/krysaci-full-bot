import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { getSettings } from '../../db.js';
import { BAR } from '../../theme.js';

// Názvy kanálů podle návrhu: 〉💂︱ Members: 152 a 〉🤖︱ Bots: 1
export const memberName = (n) => `〉💂${BAR} Members: ${n}`;
export const botName = (n) => `〉🤖${BAR} Bots: ${n}`;

const fetched = new Set();
const timers = new Map();

export async function countMembers(guild) {
  // Seznam členů se stáhne jednou, dál ho udržují události příchodu a odchodu.
  if (!fetched.has(guild.id)) {
    await guild.members.fetch().catch((err) => console.error('Stažení členů se nepodařilo:', err.message));
    fetched.add(guild.id);
  }
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  return { members: guild.memberCount - bots, bots };
}

// Discord povoluje přejmenovat kanál jen 2× za 10 minut, proto měníme jen když se číslo opravdu změnilo.
async function rename(guild, id, name) {
  if (!id) return;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (!channel || channel.name === name) return;
  await Promise.race([channel.setName(name), new Promise((resolve) => setTimeout(resolve, 10_000))]).catch((err) => console.error('Přejmenování statistik:', err.message));
}

export async function updateStats(guild) {
  const settings = await getSettings(guild.id);
  if (!settings.statsMembers && !settings.statsBots) return;
  const { members, bots } = await countMembers(guild);
  await rename(guild, settings.statsMembers, memberName(members));
  await rename(guild, settings.statsBots, botName(bots));
}

// Při příchodu a odchodu členů se aktualizace spojí do jedné za minutu.
export function scheduleStatsUpdate(guild) {
  clearTimeout(timers.get(guild.id));
  timers.set(guild.id, setTimeout(() => updateStats(guild).catch(console.error), 60_000));
}

export function startStatsSweeper(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await updateStats(guild).catch(console.error);
  };
  run();
  setInterval(run, 10 * 60_000);
}

// Vytvoří kategorii (pokud není zadaná) a dva kanály, do kterých se nedá připojit.
export async function createStatsChannels(guild, category) {
  const parent = category ?? await guild.channels.create({ name: '📊 STATS', type: ChannelType.GuildCategory });
  const { members, bots } = await countMembers(guild);
  const make = (name) => guild.channels.create({
    name, type: ChannelType.GuildVoice, parent: parent.id,
    permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [P.ViewChannel], deny: [P.Connect] }],
  });
  const [membersChannel, botsChannel] = [await make(memberName(members)), await make(botName(bots))];
  return { parent, membersChannel, botsChannel };
}
