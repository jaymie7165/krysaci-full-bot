// Zadávání data v českém čase (Europe/Prague), včetně letního času.
const TZ = 'Europe/Prague';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Posun Prahy proti UTC v minutách v daném okamžiku.
function offsetMinutes(ms) {
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUtc - Math.floor(ms / 1000) * 1000) / 60000;
}

export function pragueToUtc(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = offsetMinutes(guess);
  let t = guess - first * 60000;
  const second = offsetMinutes(t);
  if (second !== first) t = guess - second * 60000;
  return new Date(t);
}

// Přijímá "20.10. 20:00" nebo "20.10.2026 20:00". Vrací Date, nebo null.
export function parseCzechDateTime(input, now = new Date()) {
  const m = input.trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?\s+(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const [d, mo, h, mi] = [m[1], m[2], m[4], m[5]].map(Number);
  const nowYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric' }).format(now));
  let year = m[3] ? Number(m[3]) : nowYear;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  let date = pragueToUtc(year, mo, d, h, mi);
  if (!m[3] && date.getTime() < now.getTime()) date = pragueToUtc(year + 1, mo, d, h, mi);
  // Ochrana před neexistujícím dnem (např. 31.2.)
  const check = new Date(Date.UTC(year, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return date;
}
