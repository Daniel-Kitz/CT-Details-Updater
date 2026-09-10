export interface SongOccurrence {
  eventId: number;
  eventName: string;
  eventStartDate: string;
  calendarId: number | null;
  calendarName: string | null;
  arrangementId: number | null;
  arrangementName: string | null;
}

export interface SongUsage {
  songId: number;
  title: string;
  author: string | null;
  count: number;
  occurrences: SongOccurrence[];
}

export interface SongSuggestion {
  songId: number;
  title: string;
  author: string | null;
}

export interface SongUsageRange {
  from: string;
  to: string;
}

export interface SongUsageResponse {
  range: SongUsageRange;
  totalEvents: number;
  matches: SongUsage[];
}

export function normalizeSongName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

export function songMatchesQuery(title: string, query: string): boolean {
  const normalizedQuery = normalizeSongName(query);
  if (normalizedQuery === '') return false;
  return normalizeSongName(title).includes(normalizedQuery);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function rangeForMonths(months: number, now = new Date()): SongUsageRange {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

export function isValidRange(
  range: SongUsageRange,
  maxMonths: number,
): boolean {
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (!from || !to) return false;
  if (from > to) return false;
  const maxMs = maxMonths * 31 * 24 * 60 * 60 * 1000;
  return to.getTime() - from.getTime() <= maxMs;
}
