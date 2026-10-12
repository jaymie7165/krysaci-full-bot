// Vytvoření přehledného HTML přepisu ticketu.
const fmt = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Prague' });

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const br = (s) => esc(s).replace(/\n/g, '<br>');

export async function fetchAllMessages(channel, max = 2000) {
  const out = [];
  let before;
  while (out.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    out.push(...batch.values());
    before = batch.last().id;
  }
  return out.reverse();
}

function renderEmbed(embed) {
  const parts = [];
  if (embed.title) parts.push(`<strong>${esc(embed.title)}</strong>`);
  if (embed.description) parts.push(br(embed.description));
  for (const f of embed.fields ?? []) parts.push(`<em>${esc(f.name)}</em>: ${br(f.value)}`);
  return parts.length ? `<div class="embed">${parts.join('<br>')}</div>` : '';
}

function renderMessage(m) {
  const body = m.cleanContent ? `<div>${br(m.cleanContent)}</div>` : '';
  const files = [...m.attachments.values()]
    .map((a) => `<div><a href="${esc(a.url)}">${esc(a.name)}</a></div>`)
    .join('');
  const embeds = m.embeds.map(renderEmbed).join('');
  if (!body && !files && !embeds) return '';
  const name = m.member?.displayName ?? m.author.username;
  return `<div class="msg"><div class="head"><b>${esc(name)}</b>${m.author.bot ? ' <span class="bot">BOT</span>' : ''} <span class="time">${fmt.format(m.createdAt)}</span></div>${body}${files}${embeds}</div>`;
}

export function renderTranscript({ ticket, categoryLabel, guildName, messages, notes = [] }) {
  const noteHtml = notes.length
    ? `<h2>Interní poznámky</h2>${notes
        .map((n) => `<div class="msg note"><div class="head"><b>${esc(n.author_name)}</b> <span class="time">${fmt.format(n.created_at)}</span></div>${br(n.content)}</div>`)
        .join('')}`
    : '';

  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Ticket #${ticket.id}</title><style>
body{background:#1e1f22;color:#dbdee1;font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 8px}.sub{color:#949ba4;margin-bottom:24px}
.msg{padding:8px 0;border-bottom:1px solid #2b2d31}.head{margin-bottom:2px}.time{color:#949ba4;font-size:12px;margin-left:6px}
.bot{background:#8b93ff;color:#fff;font-size:10px;padding:1px 5px;border-radius:4px}a{color:#8b93ff}
.embed{border-left:3px solid #8b93ff;background:#2b2d31;padding:8px 12px;margin-top:6px;border-radius:4px}
.note{background:#2b2d31;padding:8px 12px;border-radius:6px;margin-bottom:6px;border:0}
</style></head><body><h1>Ticket #${ticket.id} · ${esc(categoryLabel)}</h1>
<div class="sub">${esc(guildName)} · vytvořen ${fmt.format(ticket.created_at)}</div>
${messages.map(renderMessage).join('')}${noteHtml}</body></html>`;
}
