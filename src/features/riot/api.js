import { config } from '../../config.js';

// Regionální směrování pro account-v1 podle serveru hry.
const REGIONS = {
  eun1: 'europe', euw1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};
const region = REGIONS[config.riotPlatform] ?? 'europe';

// Pořadí odpovídá RANKS.lol v roles/data.js.
export const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

export class RiotError extends Error {
  constructor(status) {
    super(`Riot API ${status}`);
    this.status = status;
  }
}

export const hasKey = () => Boolean(config.riotKey);

async function call(host, path) {
  if (!config.riotKey) throw new RiotError(0);
  const res = await fetch(`https://${host}.api.riotgames.com${path}`, { headers: { 'X-Riot-Token': config.riotKey } });
  if (res.status === 404) return null;
  if (!res.ok) throw new RiotError(res.status);
  return res.json();
}

export const getAccount = (name, tag) =>
  call(region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);

// Servery (platformy) ve stejné oblasti jako ten výchozí, kvůli automatickému nalezení účtu.
const PLATFORMS_IN_REGION = (platform) => Object.keys(REGIONS).filter((p) => REGIONS[p] === (REGIONS[platform] ?? 'europe'));

export async function getIconId(puuid, platform = config.riotPlatform) {
  const summoner = await call(platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`);
  return summoner?.profileIconId ?? null;
}

// Zjistí, na kterém serveru účet hraje (EUNE, EUW...), aby nezáleželo na nastavení RIOT_PLATFORM.
export async function findPlatform(puuid) {
  const candidates = [config.riotPlatform, ...PLATFORMS_IN_REGION(config.riotPlatform).filter((p) => p !== config.riotPlatform)];
  for (const platform of candidates) {
    const iconId = await getIconId(puuid, platform);
    if (iconId != null) return { platform, iconId };
  }
  return null;
}

export async function getSoloRank(puuid, platform = config.riotPlatform) {
  const entries = await call(platform, `/lol/league/v4/entries/by-puuid/${puuid}`);
  const solo = entries?.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  return solo ? { tier: solo.tier, division: solo.rank } : null;
}

let ddVersion = null;
export async function iconUrl(id) {
  try {
    if (!ddVersion) ddVersion = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
    return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${id}.png`;
  } catch {
    return null;
  }
}
