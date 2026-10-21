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
    CREATE TABLE IF NOT EXISTS custom_lobbies (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      organizer_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT '5v5',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      winner TEXT,
      voice_blue TEXT,
      voice_red TEXT,
      voice_empty_since TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS custom_players (
      lobby_id INT NOT NULL REFERENCES custom_lobbies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      team TEXT,
      positions TEXT NOT NULL DEFAULT '',
      rank_idx INT,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (lobby_id, user_id)
    );
    ALTER TABLE lfg_posts ADD COLUMN IF NOT EXISTS founder_avatar TEXT;
    CREATE TABLE IF NOT EXISTS riot_links (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      puuid TEXT NOT NULL,
      riot_id TEXT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT false,
      pending_icon INT,
      tier TEXT,
      division TEXT,
      rank_idx INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS achievements (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id, key)
    );
    CREATE TABLE IF NOT EXISTS suggestions (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS suggestion_votes (
      suggestion_id INT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      vote SMALLINT NOT NULL,
      PRIMARY KEY (suggestion_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      starts_at TIMESTAMPTZ NOT NULL,
      capacity INT,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      reminded BOOLEAN NOT NULL DEFAULT false,
      started BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS event_signups (
      event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      attended BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (event_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      bracket_message_id TEXT,
      name TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'signup',
      max_players INT NOT NULL DEFAULT 40,
      created_by TEXT NOT NULL,
      winner_team INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tournament_teams (
      id SERIAL PRIMARY KEY,
      tournament_id INT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      captain_id TEXT NOT NULL,
      seed INT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tournament_players (
      tournament_id INT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      rank_idx INT,
      team_id INT REFERENCES tournament_teams(id) ON DELETE SET NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tournament_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS tournament_matches (
      id SERIAL PRIMARY KEY,
      tournament_id INT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round INT NOT NULL,
      idx INT NOT NULL,
      team_a INT,
      team_b INT,
      winner INT
    );
    CREATE TABLE IF NOT EXISTS lounges (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      locked BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE riot_links ADD COLUMN IF NOT EXISTS platform TEXT;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS opener_avatar TEXT;
    ALTER TABLE custom_lobbies ADD COLUMN IF NOT EXISTS draft_blue TEXT;
    ALTER TABLE custom_lobbies ADD COLUMN IF NOT EXISTS draft_red TEXT;
    ALTER TABLE custom_lobbies ADD COLUMN IF NOT EXISTS draft_order TEXT;
    ALTER TABLE custom_lobbies ADD COLUMN IF NOT EXISTS draft_turn INT NOT NULL DEFAULT 0;
    ALTER TABLE custom_lobbies ADD COLUMN IF NOT EXISTS join_link TEXT;
    ALTER TABLE custom_lobbies ADD COLUMN IF NOT EXISTS voice_blue_empty_since TIMESTAMPTZ;
    ALTER TABLE custom_lobbies ADD COLUMN IF NOT EXISTS voice_red_empty_since TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS pulses (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      ends_at TIMESTAMPTZ NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pulse_votes (
      pulse_id INT NOT NULL REFERENCES pulses(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      PRIMARY KEY (pulse_id, user_id, option_id)
    );
    CREATE TABLE IF NOT EXISTS streamers (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      login TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      discord_user_id TEXT,
      is_live BOOLEAN NOT NULL DEFAULT false,
      session_key TEXT,
      channel_id TEXT,
      message_id TEXT,
      announced_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      last_title TEXT,
      offline_polls INT NOT NULL DEFAULT 0,
      UNIQUE (guild_id, platform, login)
    );
    CREATE TABLE IF NOT EXISTS mod_actions (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      type TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      rule TEXT NOT NULL DEFAULT '',
      duration_min INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mod_actions_user ON mod_actions (guild_id, user_id);
    CREATE TABLE IF NOT EXISTS member_cards (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      style TEXT,
      times TEXT[] NOT NULL DEFAULT '{}',
      open_to TEXT,
      about TEXT NOT NULL DEFAULT '',
      channel_id TEXT,
      message_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS card_hellos (
      guild_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, from_id, to_id)
    );
    CREATE TABLE IF NOT EXISTS hrajeme (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      creator_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      lfg_post_id INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS hrajeme_votes (
      hrajeme_id INT NOT NULL REFERENCES hrajeme(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      PRIMARY KEY (hrajeme_id, user_id)
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
