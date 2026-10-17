import { getSettings } from '../../db.js';

export const ROLE_NAME = 'Myš';
export const ROLE_COLOR = 0xe8a5b9; // jemná růžová; jde změnit parametrem nebo později v nastavení role

// "#E8A5B9" nebo "E8A5B9" -> číslo, jinak null
export function parseColor(input) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(input).trim());
  return m ? Number.parseInt(m[1], 16) : null;
}

// Použije zadanou roli, jinak najde existující "Myš", a když žádná není, vytvoří ji.
export async function ensureRole(guild, { role, color } = {}) {
  if (role) return { role, created: false };
  await guild.roles.fetch();
  const found = guild.roles.cache.find((r) => r.name.toLowerCase() === ROLE_NAME.toLowerCase() && !r.managed);
  if (found) return { role: found, created: false };
  const created = await guild.roles.create({
    name: ROLE_NAME, color: color ?? ROLE_COLOR, mentionable: false, reason: 'Základní role pro všechny členy',
  });
  return { role: created, created: true };
}

// Bot může přidělit jen roli, která je v hierarchii pod jeho nejvyšší rolí.
export const canAssign = (guild, role) =>
  role.id !== guild.id && !role.managed && role.comparePositionTo(guild.members.me.roles.highest) < 0;

// Nový člen dostane roli automaticky (boti ne).
export async function assignBaseRole(member) {
  if (member.user.bot) return;
  const { baseRole } = await getSettings(member.guild.id);
  if (!baseRole || member.roles.cache.has(baseRole)) return;
  await member.roles.add(baseRole, 'Základní role').catch((err) => console.error('Základní role:', err.message));
}

// Přidělí roli všem lidem na serveru, kteří ji ještě nemají. Opakované spuštění nikoho nezdvojí.
export async function backfillBaseRole(guild, roleId, onProgress) {
  const members = await guild.members.fetch();
  const targets = [...members.values()].filter((m) => !m.user.bot);
  let added = 0;
  let had = 0;
  let failed = 0;
  let done = 0;
  for (const member of targets) {
    if (member.roles.cache.has(roleId)) {
      had++;
    } else {
      try {
        await member.roles.add(roleId, 'Základní role pro všechny členy');
        added++;
      } catch (err) {
        failed++;
        // Když selhávají hned první pokusy kvůli oprávnění, nemá smysl pokračovat.
        if (err.code === 50013 && added === 0 && failed >= 3) throw new Error('missing-permissions');
      }
    }
    done++;
    if (onProgress && done % 25 === 0) await onProgress({ done, total: targets.length }).catch(() => {});
  }
  return { total: targets.length, added, had, failed };
}
