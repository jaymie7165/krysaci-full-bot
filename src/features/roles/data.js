// Seznam her, ranků a věkových kategorií. Chceš něco přidat nebo změnit? Uprav jen tento soubor
// a spusť znovu /nastaveni role (chybějící role se doplní).
export const GAMES = [
  { id: 'lol', name: 'League of Legends', short: 'LoL' },
  { id: 'valorant', name: 'Valorant', short: 'Valorant' },
  { id: 'cs2', name: 'CS2', short: 'CS2' },
  { id: 'dbd', name: 'Dead by Daylight' },
  { id: 'f13', name: 'Friday the 13th' },
  { id: 'phasmophobia', name: 'Phasmophobia' },
  { id: 'ggd', name: 'Goose Goose Duck' },
  { id: 'feign', name: 'Feign' },
  { id: 'peak', name: 'Peak' },
  { id: 'lethal', name: 'Lethal Company' },
  { id: 'golf', name: 'Golf With Your Friends' },
  { id: 'tavernia', name: 'Tavernia' },
];

// Hry, u kterých jde zvolit rank. Klíč je id hry z GAMES.
export const RANKS = {
  lol: ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'],
  valorant: ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'],
  cs2: ['Silver', 'Gold Nova', 'Master Guardian', 'Legendary Eagle', 'Supreme', 'Global Elite'],
};

export const AGES = [
  { id: '13-15', name: '13–15' },
  { id: '16-17', name: '16–17' },
  { id: '18plus', name: '18+' },
  { id: '30plus', name: '30+' },
];

export const gameById = (id) => GAMES.find((g) => g.id === id);

// Všechny role, které bot spravuje: { key, name }
export function allRoleDefs() {
  const defs = [];
  for (const g of GAMES) defs.push({ key: `game:${g.id}`, name: g.name });
  for (const a of AGES) defs.push({ key: `age:${a.id}`, name: a.name });
  for (const [gameId, ranks] of Object.entries(RANKS)) {
    const game = gameById(gameId);
    ranks.forEach((rank, i) => defs.push({ key: `rank:${gameId}:${i}`, name: `${game.short} · ${rank}` }));
  }
  return defs;
}

// Rank hráče z LoL rank rolí (index do RANKS.lol), nebo null.
export function lolRankFromMember(member, roleMap) {
  if (!roleMap) return null;
  for (let i = RANKS.lol.length - 1; i >= 0; i--) {
    if (member.roles.cache.has(roleMap[`rank:lol:${i}`])) return i;
  }
  return null;
}
