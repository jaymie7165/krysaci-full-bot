import 'dotenv/config';

for (const key of ['DISCORD_TOKEN', 'GUILD_ID', 'DATABASE_URL']) {
  if (!process.env[key]) {
    console.error(`Chybí proměnná prostředí ${key}. Viz README.`);
    process.exit(1);
  }
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // Riot API je volitelné. Bez klíče se propojení LoL účtu a automatický rank vypnou.
  riotKey: process.env.RIOT_API_KEY || null,
  riotPlatform: (process.env.RIOT_PLATFORM || 'eun1').toLowerCase(),
  // Oznamování streamů je volitelné, každá platforma má vlastní přístupové údaje.
  twitchClientId: process.env.TWITCH_CLIENT_ID || null,
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || null,
  kickClientId: process.env.KICK_CLIENT_ID || null,
  kickClientSecret: process.env.KICK_CLIENT_SECRET || null,
};
