export const orderInstant = "COALESCE(p.fecha_utc, CONVERT_TZ(p.fecha, ?, '+00:00'))";

// Both operands are DATETIME values expressed in UTC. Read them as text to
// avoid mysql2 interpreting the value in the process's local time zone.
export function serializeOrderInstant(utc: string): string {
  return new Date(utc.replace(' ', 'T').slice(0, 23) + 'Z').toISOString();
}

const commercialDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayMs = 86_400_000;

function commercialDateKey(instant: number): number {
  const parts = commercialDay.formatToParts(instant);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  return year * 10_000 + month * 100 + day;
}

function startOfCommercialDay(utcMidnight: number): string {
  const date = new Date(utcMidnight);
  const target = date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  let before = utcMidnight - dayMs;
  let after = utcMidnight + dayMs;
  // Find the first UTC instant in this civil day, including days when the
  // historical Buenos Aires offset changed at midnight.
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (commercialDateKey(middle) < target) before = middle;
    else after = middle;
  }
  return new Date(after).toISOString().replace('T', ' ').slice(0, -1);
}

export function commercialDayUtcRange(day: string): { from: string; until: string | null } {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  return {
    from: startOfCommercialDay(utcMidnight),
    until: day === '9999-12-31' ? null : startOfCommercialDay(utcMidnight + dayMs),
  };
}
