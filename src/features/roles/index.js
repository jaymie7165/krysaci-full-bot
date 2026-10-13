import {
  ActionRowBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getSettings, query } from '../../db.js';
import { AGES, GAMES, RANKS, gameById } from './data.js';

const EPHEMERAL = MessageFlags.Ephemeral;

export async function handleRolesInteraction(interaction) {
  const [, action, ...args] = interaction.customId.split(':');
  const map = action === 'othermodal' || action === 'other' ? null : await loadMap(interaction);
  if (map === false) return;

  try {
    switch (action) {
      case 'games': return showGames(interaction, map);
      case 'setgames': return setGames(interaction, map);
      case 'age': return showAge(interaction, map);
      case 'setage': return setAge(interaction, map);
      case 'ranks': return showRanks(interaction, map);
      case 'setrank': return setRank(interaction, map, args[0]);
      case 'other': return showOther(interaction);
      case 'othermodal': return saveOther(interaction);
    }
  } catch (err) {
    if (err.code === 50013) {
      const payload = {
        content: 'Bot nemá oprávnění tuto roli přidělit. Správce musí v Nastavení serveru → Role přetáhnout roli bota **nad** role pro výběr.',
        flags: EPHEMERAL,
      };
      if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
      return interaction.reply(payload);
    }
    throw err;
  }
}

async function loadMap(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!settings.roleMap) {
    await interaction.reply({ content: 'Role ještě nejsou nastavené. Napiš prosím správci serveru.', flags: EPHEMERAL });
    return false;
  }
  return settings.roleMap;
}

// Přidá/odebere role a vrátí aktualizovaného člena.
async function apply(member, add, remove) {
  let m = member;
  const rm = remove.filter((id) => m.roles.cache.has(id));
  const ad = add.filter((id) => !m.roles.cache.has(id));
  if (rm.length) m = await m.roles.remove(rm);
  if (ad.length) m = await m.roles.add(ad);
  return m;
}

const rankIds = (map, gameId) => RANKS[gameId].map((_, i) => map[`rank:${gameId}:${i}`]).filter(Boolean);
const row = (menu) => new ActionRowBuilder().addComponents(menu);

/* ---------- Hry ---------- */

async function showGames(interaction, map) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('roles:setgames')
    .setPlaceholder('Vyber hry, které hraješ…')
    .setMinValues(0)
    .setMaxValues(GAMES.length)
    .addOptions(GAMES.map((g) => ({
      label: g.name, value: g.id, default: interaction.member.roles.cache.has(map[`game:${g.id}`]),
    })));
  await interaction.reply({ content: 'Vyber všechny hry, které hraješ. Odznačením hru odebereš.', components: [row(menu)], flags: EPHEMERAL });
}

async function setGames(interaction, map) {
  const selected = new Set(interaction.values);
  const add = [];
  const remove = [];
  for (const g of GAMES) {
    const id = map[`game:${g.id}`];
    if (!id) continue;
    if (selected.has(g.id)) add.push(id);
    else {
      remove.push(id);
      if (RANKS[g.id]) remove.push(...rankIds(map, g.id)); // bez hry nedává rank smysl
    }
  }
  await apply(interaction.member, add, remove);
  const names = GAMES.filter((g) => selected.has(g.id)).map((g) => g.name);
  await interaction.update({
    content: names.length ? `Uloženo. Hraješ: ${names.join(', ')}.` : 'Uloženo. Žádná hra není vybraná.',
    components: [],
  });
}

/* ---------- Věk ---------- */

async function showAge(interaction, map) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('roles:setage')
    .setPlaceholder('Vyber věkovou kategorii…')
    .addOptions(AGES.map((a) => ({
      label: a.name, value: a.id, default: interaction.member.roles.cache.has(map[`age:${a.id}`]),
    })));
  await interaction.reply({ content: 'Vyber svou věkovou kategorii.', components: [row(menu)], flags: EPHEMERAL });
}

async function setAge(interaction, map) {
  const chosen = interaction.values[0];
  const add = [map[`age:${chosen}`]];
  const remove = AGES.filter((a) => a.id !== chosen).map((a) => map[`age:${a.id}`]);
  await apply(interaction.member, add.filter(Boolean), remove.filter(Boolean));
  await interaction.update({ content: `Uloženo. Věková kategorie: ${AGES.find((a) => a.id === chosen).name}.`, components: [] });
}

/* ---------- Ranky ---------- */

function rankRows(member, map) {
  const rows = [];
  for (const gameId of Object.keys(RANKS)) {
    const game = gameById(gameId);
    if (!member.roles.cache.has(map[`game:${gameId}`])) continue;
    const current = RANKS[gameId].findIndex((_, i) => member.roles.cache.has(map[`rank:${gameId}:${i}`]));
    const options = RANKS[gameId].map((rank, i) => ({
      label: `${game.short} · ${rank}`, value: String(i), default: i === current,
    }));
    options.push({ label: `${game.short} · bez ranku`, value: 'none', default: current === -1 });
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`roles:setrank:${gameId}`).setPlaceholder(`${game.name}: rank`).addOptions(options)));
  }
  return rows;
}

async function showRanks(interaction, map) {
  const rows = rankRows(interaction.member, map);
  if (!rows.length) {
    return interaction.reply({
      content: 'Rank jde zvolit u LoL, Valorantu a CS2. Nejdřív si tlačítkem **Hry** vyber některou z nich.',
      flags: EPHEMERAL,
    });
  }
  await interaction.reply({ content: 'Vyber svůj rank u jednotlivých her.', components: rows, flags: EPHEMERAL });
}

async function setRank(interaction, map, gameId) {
  const choice = interaction.values[0];
  const all = rankIds(map, gameId);
  const wanted = choice === 'none' ? null : map[`rank:${gameId}:${choice}`];
  const member = await apply(interaction.member, wanted ? [wanted] : [], all.filter((id) => id !== wanted));
  await interaction.update({ content: 'Uloženo.', components: rankRows(member, map) });
}

/* ---------- Jiná hra ---------- */

async function showOther(interaction) {
  const { rows } = await query('SELECT other_activities FROM profiles WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, interaction.user.id]);
  const current = rows[0]?.other_activities ?? [];
  const input = new TextInputBuilder()
    .setCustomId('list')
    .setLabel('Další hry nebo aktivity (odděl čárkou)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(300)
    .setPlaceholder('Např. Minecraft, koukání na filmy');
  if (current.length) input.setValue(current.join(', '));
  await interaction.showModal(new ModalBuilder().setCustomId('roles:othermodal').setTitle('Jiná hra nebo aktivita').addComponents(row(input)));
}

async function saveOther(interaction) {
  const items = interaction.fields.getTextInputValue('list')
    .split(/[,\n]/).map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 5);
  await query(
    `INSERT INTO profiles (guild_id, user_id, other_activities) VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET other_activities = $3`,
    [interaction.guildId, interaction.user.id, JSON.stringify(items)],
  );
  await interaction.reply({
    content: items.length ? `Uloženo: ${items.join(', ')}.` : 'Seznam je prázdný.',
    flags: EPHEMERAL,
  });
}
