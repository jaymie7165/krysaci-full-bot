import { config } from '../../config.js';

export const hasTwitch = () => Boolean(config.twitchClientId && config.twitchClientSecret);
export const hasKick = () => Boolean(config.kickClientId && config.kickClientSecret);

// Přístupové tokeny aplikace se drží v paměti a před vypršením se obnoví.
const tokens = { twitch: { value: null, exp: 0 }, kick: { value: null, exp: 0 } };

async function getToken(platform, force = false) {
  const t = tokens[platform];
  if (!force && t.value && Date.now() < t.exp - 60_000) return t.value;
  const [url, id, secret] = platform === 'twitch'
    ? ['https://id.twitch.tv/oauth2/token', config.twitchClientId, config.twitchClientSecret]
    : ['https://id.kick.com/oauth/token', config.kickClientId, config.kickClientSecret];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`${platform} token ${res.status}`);
  const body = await res.json();
  t.value = body.access_token;
  t.exp = Date.now() + (body.expires_in ?? 3600) * 1000;
  return t.value;
}

// Zavolá API, při 401 jednou obnoví token a zkusí to znovu.
async function api(platform, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(platform, attempt > 0);
    const headers = platform === 'twitch'
      ? { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${token}` }
      : { Authorization: `Bearer ${token}` };
    const res = await fetch(url, { headers });
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) throw new Error(`${platform} API ${res.status}`);
    return res.json();
  }
  throw new Error(`${platform} API: neplatný token`);
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/* ---------- Twitch ---------- */

export async function twitchUser(login) {
  const body = await api('twitch', `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`);
  const u = body.data?.[0];
  return u ? { platformId: u.id, login: u.login, displayName: u.display_name, avatar: u.profile_image_url } : null;
}

// Vrací jen kanály, které jsou právě live: Map(login -> stream).
export async function twitchLive(logins) {
  const live = new Map();
  for (const part of chunk(logins, 100)) {
    const qs = part.map((l) => `user_login=${encodeURIComponent(l)}`).join('&');
    const body = await api('twitch', `https://api.twitch.tv/helix/streams?first=100&${qs}`);
    for (const s of body.data ?? []) {
      if (s.type && s.type !== 'live') continue;
      live.set(s.user_login.toLowerCase(), {
        sessionKey: s.id, title: s.title, game: s.game_name, viewers: s.viewer_count, startedAt: s.started_at,
        thumbnail: s.thumbnail_url ? s.thumbnail_url.replace('{width}', '640').replace('{height}', '360') : null,
        url: `https://twitch.tv/${s.user_login}`,
      });
    }
  }
  return live;
}

/* ---------- Kick (oficiální veřejné API) ---------- */

const list = (body) => (Array.isArray(body) ? body : body?.data ?? []);

export async function kickChannel(slug) {
  const body = await api('kick', `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`);
  const c = list(body)[0];
  return c ? { platformId: String(c.broadcaster_user_id), login: (c.slug ?? slug).toLowerCase(), displayName: c.slug ?? slug, avatar: c.profile_picture ?? null } : null;
}

// Vrací jen kanály, které jsou právě live: Map(broadcaster_user_id -> stream).
export async function kickLive(ids) {
  const live = new Map();
  for (const part of chunk(ids, 50)) {
    const qs = part.map((id) => `broadcaster_user_id=${encodeURIComponent(id)}`).join('&');
    const body = await api('kick', `https://api.kick.com/public/v1/livestreams?${qs}`);
    for (const s of list(body)) {
      const thumb = typeof s.thumbnail === 'string' ? s.thumbnail : s.thumbnail?.url ?? null;
      live.set(String(s.broadcaster_user_id), {
        sessionKey: s.started_at, title: s.stream_title, game: s.category?.name ?? null, viewers: s.viewer_count ?? 0,
        startedAt: s.started_at, thumbnail: thumb, avatar: s.profile_picture ?? null, url: `https://kick.com/${s.slug}`,
      });
    }
  }
  return live;
}
