import type { SongOccurrence, SongUsage } from '@ct-details-updater/shared';
import { ChurchToolsClient, ChurchToolsError } from './churchtools.js';
import type { Config } from './config.js';
import type { CachedIndex, Session } from './sessions.js';

interface RawEvent {
  id: number;
  name?: string;
  startDate?: string;
  calendar?: { id?: number; domainIdentifier?: number; title?: string; name?: string };
  calendarId?: number;
  isCanceled?: boolean;
  canceled?: boolean;
}

interface RawAgendaResponse {
  data?: { items?: RawAgendaItem[] };
}

interface RawAgendaItem {
  id: number;
  title?: string | null;
  type: string;
  song?: {
    songId?: number;
    arrangementId?: number | null;
    arrangement?: string | null;
    title?: string | null;
  } | null;
}

interface PageMeta {
  currentPage?: number;
  lastPage?: number;
  totalPages?: number;
  count?: number;
  perPage?: number;
}

interface Page<T> {
  data: T[];
  meta?: { pagination?: PageMeta };
}

export interface UsageIndex {
  totalEvents: number;
  songs: Map<number, SongUsage>;
}

async function fetchAllPages<T>(
  client: ChurchToolsClient,
  path: string,
  query: URLSearchParams,
  limit = 100,
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    params.set('limit', String(limit));
    const response = await client.request<Page<T> | T[]>(`${path}?${params}`);
    const body: Page<T> = Array.isArray(response)
      ? { data: response }
      : (response as Page<T>);
    const items = body.data ?? [];
    results.push(...items);
    const meta = body.meta?.pagination;
    const lastPage = meta?.lastPage ?? meta?.totalPages;
    if (
      items.length === 0 ||
      (lastPage !== undefined && page >= lastPage) ||
      (lastPage === undefined && items.length < limit)
    ) {
      break;
    }
    page += 1;
  }
  return results;
}

function pickCalendar(event: RawEvent): { id: number | null; name: string | null } {
  const id =
    event.calendar?.id ??
    event.calendar?.domainIdentifier ??
    event.calendarId ??
    null;
  const name = event.calendar?.title ?? event.calendar?.name ?? null;
  return { id, name };
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchAgenda(
  client: ChurchToolsClient,
  eventId: number,
): Promise<RawAgendaItem[]> {
  try {
    const raw = await client.request<RawAgendaResponse | { items?: RawAgendaItem[] }>(
      `/events/${eventId}/agenda`,
    );
    const items =
      (raw as RawAgendaResponse).data?.items ??
      (raw as { items?: RawAgendaItem[] }).items ??
      [];
    return items;
  } catch (error) {
    if (
      error instanceof ChurchToolsError &&
      (error.status === 404 || error.status === 403)
    ) {
      return [];
    }
    throw error;
  }
}

function isoDay(startDate: string | undefined): number | null {
  if (!startDate) return null;
  const isoDate = startDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  // Interpret at noon UTC so timezone offsets can't push the weekday over a
  // boundary for any realistic local time (Sunday 10am CET stays Sunday).
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay();
}

export interface UsageIndexLogger {
  debug?: (msg: object) => void;
  info?: (msg: object) => void;
}

export interface BuildUsageIndexOptions {
  from: string;
  to: string;
  concurrency: number;
  weekdays?: number[] | null;
  logger?: UsageIndexLogger;
}

export async function buildUsageIndex(
  client: ChurchToolsClient,
  options: BuildUsageIndexOptions,
): Promise<UsageIndex> {
  const { from, to, concurrency, weekdays, logger } = options;
  const query = new URLSearchParams({ from, to });
  const events = await fetchAllPages<RawEvent>(client, '/events', query, 100);

  const activeEvents = events.filter(
    (event) => !(event.isCanceled ?? event.canceled),
  );

  const relevant =
    weekdays && weekdays.length > 0
      ? activeEvents.filter((event) => {
          const day = isoDay(event.startDate);
          return day !== null && weekdays.includes(day);
        })
      : activeEvents;

  logger?.info?.({
    msg: 'usage_index_building',
    from,
    to,
    weekdays: weekdays ?? null,
    events_returned: events.length,
    events_active: activeEvents.length,
    events_after_weekday_filter: relevant.length,
  });

  const agendas = await withConcurrency(relevant, concurrency, async (event) => {
    const items = await fetchAgenda(client, event.id);
    return { event, items };
  });

  const songs = new Map<number, SongUsage>();

  for (const { event, items } of agendas) {
    const calendar = pickCalendar(event);
    for (const item of items) {
      if (item.type !== 'song' || !item.song?.songId) continue;
      const songId = item.song.songId;
      const title =
        (item.song.title && item.song.title.trim()) ||
        (item.title && item.title.trim()) ||
        `Song #${songId}`;

      const occurrence: SongOccurrence = {
        eventId: event.id,
        eventName: event.name ?? `Event ${event.id}`,
        eventStartDate: event.startDate ?? '',
        calendarId: calendar.id,
        calendarName: calendar.name,
        arrangementId: item.song.arrangementId ?? null,
        arrangementName: item.song.arrangement ?? null,
      };

      const existing = songs.get(songId);
      if (existing) {
        existing.count += 1;
        existing.occurrences.push(occurrence);
      } else {
        songs.set(songId, {
          songId,
          title,
          author: null,
          count: 1,
          occurrences: [occurrence],
        });
      }
    }
  }

  for (const usage of songs.values()) {
    usage.occurrences.sort((a, b) =>
      b.eventStartDate.localeCompare(a.eventStartDate),
    );
  }

  return { totalEvents: relevant.length, songs };
}

export interface EnsureIndexDeps {
  config: Pick<Config, 'CHURCHTOOLS_BASE_URL' | 'CACHE_TTL_MINUTES' | 'AGENDA_CONCURRENCY'>;
  logger?: UsageIndexLogger;
}

const inFlight = new Map<string, Promise<UsageIndex>>();

export interface EnsureIndexRequest {
  from: string;
  to: string;
  weekdays?: number[] | null;
}

function weekdayKey(weekdays: number[] | null | undefined): string {
  if (!weekdays || weekdays.length === 0) return 'all';
  return [...new Set(weekdays)].sort((a, b) => a - b).join(',');
}

export async function ensureUsageIndex(
  session: Session,
  request: EnsureIndexRequest,
  deps: EnsureIndexDeps,
): Promise<CachedIndex> {
  const { from, to, weekdays } = request;
  const cacheKey = `${from}|${to}|${weekdayKey(weekdays)}`;
  const ttlMs = deps.config.CACHE_TTL_MINUTES * 60 * 1000;
  const cached = session.cache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < ttlMs) {
    return cached;
  }

  const flightKey = `${session.id}|${cacheKey}`;
  let promise = inFlight.get(flightKey);
  if (!promise) {
    const client = new ChurchToolsClient(deps.config, session.jar);
    promise = buildUsageIndex(client, {
      from,
      to,
      concurrency: deps.config.AGENDA_CONCURRENCY,
      weekdays: weekdays ?? null,
      logger: deps.logger,
    }).finally(() => {
      inFlight.delete(flightKey);
    });
    inFlight.set(flightKey, promise);
  }

  const index = await promise;
  const entry: CachedIndex = { builtAt: Date.now(), from, to, index };
  session.cache.set(cacheKey, entry);
  return entry;
}
