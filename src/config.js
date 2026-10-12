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
};
