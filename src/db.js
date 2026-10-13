import pg from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

export const query = (text, params) => pool.query(text, params);

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT UNIQUE,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      answers JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      claimed_by TEXT,
      panel_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      closed_by TEXT,
      close_reason TEXT,
      rating INT
    );
    CREATE TABLE IF NOT EXISTS profiles (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      other_activities JSONB NOT NULL DEFAULT '[]',
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS lfg_posts (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      founder_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      capacity INT NOT NULL,
      mode_text TEXT NOT NULL DEFAULT '',
      rank_text TEXT NOT NULL DEFAULT '',
      time_text TEXT NOT NULL DEFAULT '',
      vibe_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      voice_channel_id TEXT,
      voice_empty_since TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS lfg_members (
      post_id INT NOT NULL REFERENCES lfg_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS ticket_notes (
      id SERIAL PRIMARY KEY,
      ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// Nastavení serveru se ukládá jako JSON, takže další fáze přidají klíče bez změny tabulek.
export async function getSettings(guildId) {
  const { rows } = await query('SELECT data FROM settings WHERE guild_id = $1', [guildId]);
  return rows[0]?.data ?? {};
}

export async function saveSettings(guildId, patch) {
  await query(
    `INSERT INTO settings (guild_id, data) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET data = settings.data || $2`,
    [guildId, JSON.stringify(patch)],
  );
}
