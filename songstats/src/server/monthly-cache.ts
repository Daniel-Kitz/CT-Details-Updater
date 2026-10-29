import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rangeForMonths, type SongUsage } from '@ct-details-updater/shared';
import type { FastifyBaseLogger } from 'fastify';
import { ChurchToolsClient } from './churchtools.js';
import type { Config } from './config.js';
import { buildUsageIndex } from './song-index.js';
import type { CachedIndex } from './sessions.js';

const CACHE_VERSION = 1;
const CACHE_MONTHS = 6;
const CACHE_WEEKDAYS = [0] as const;

interface PersistedCache {
  version: number;
  monthKey: string;
  builtAt: number;
  from: string;
  to: string;
  weekdays: number[];
  totalEvents: number;
  songs: SongUsage[];
}

function monthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function isSundayOnly(weekdays: number[] | null | undefined): boolean {
  return weekdays?.length === 1 && weekdays[0] === 0;
}

function serialize(entry: CachedIndex, key: string): PersistedCache {
  return {
    version: CACHE_VERSION,
    monthKey: key,
    builtAt: entry.builtAt,
    from: entry.from,
    to: entry.to,
    weekdays: [...CACHE_WEEKDAYS],
    totalEvents: entry.index.totalEvents,
    songs: [...entry.index.songs.values()],
  };
}

function deserialize(raw: PersistedCache): CachedIndex | null {
  if (
    raw.version !== CACHE_VERSION ||
    !Array.isArray(raw.songs) ||
    !isSundayOnly(raw.weekdays)
  ) {
    return null;
  }
  const songs = new Map<number, SongUsage>();
  for (const song of raw.songs) {
    if (typeof song?.songId === 'number') songs.set(song.songId, song);
  }
  return {
    builtAt: raw.builtAt,
    from: raw.from,
    to: raw.to,
    index: {
      totalEvents: raw.totalEvents,
      songs,
    },
  };
}

export class MonthlyUsageCache {
  private entry: CachedIndex | null = null;
  private entryMonth: string | null = null;
  private refreshPromise: Promise<CachedIndex | null> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly logger: FastifyBaseLogger,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.CHURCHTOOLS_LOGIN_TOKEN);
  }

  async start(): Promise<void> {
    await this.load();
    if (!this.enabled) {
      this.logger.warn(
        'monthly_cache_disabled: CHURCHTOOLS_LOGIN_TOKEN is not configured',
      );
      return;
    }

    void this.refreshIfStale('startup');
    this.timer = setInterval(
      () => void this.refreshIfStale('schedule'),
      this.config.MONTHLY_CACHE_CHECK_MINUTES * 60 * 1000,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async getSixMonthSundayIndex(): Promise<CachedIndex | null> {
    if (!this.enabled) return null;
    if (this.entry && this.entryMonth === monthKey()) return this.entry;
    return this.refreshIfStale('request');
  }

  canServe(months: number | undefined, weekdays: number[] | null): boolean {
    return months === CACHE_MONTHS && isSundayOnly(weekdays);
  }

  private async refreshIfStale(reason: string): Promise<CachedIndex | null> {
    const currentMonth = monthKey();
    if (this.entry && this.entryMonth === currentMonth) return this.entry;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refresh(currentMonth, reason).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refresh(
    currentMonth: string,
    reason: string,
  ): Promise<CachedIndex | null> {
    const token = this.config.CHURCHTOOLS_LOGIN_TOKEN;
    if (!token) return null;

    const startedAt = Date.now();
    this.logger.info({ reason, currentMonth }, 'monthly_cache_refresh_started');

    try {
      const client = new ChurchToolsClient(this.config);
      await client.request('/whoami', {
        headers: { Authorization: `Login ${token}` },
      });

      const range = rangeForMonths(CACHE_MONTHS);
      const index = await buildUsageIndex(client, {
        from: range.from,
        to: range.to,
        concurrency: this.config.AGENDA_CONCURRENCY,
        weekdays: [...CACHE_WEEKDAYS],
        logger: this.logger,
      });
      const entry: CachedIndex = {
        builtAt: Date.now(),
        from: range.from,
        to: range.to,
        index,
      };

      await this.persist(entry, currentMonth);
      this.entry = entry;
      this.entryMonth = currentMonth;
      this.logger.info(
        {
          reason,
          currentMonth,
          durationMs: Date.now() - startedAt,
          totalEvents: index.totalEvents,
          songs: index.songs.size,
        },
        'monthly_cache_refresh_completed',
      );
      return entry;
    } catch (error) {
      this.logger.error(
        {
          reason,
          currentMonth,
          error: error instanceof Error ? error.message : String(error),
        },
        'monthly_cache_refresh_failed',
      );
      return this.entry;
    }
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(
        await readFile(this.config.MONTHLY_CACHE_FILE, 'utf8'),
      ) as PersistedCache;
      const entry = deserialize(raw);
      if (!entry) {
        this.logger.warn('monthly_cache_ignored: unsupported cache format');
        return;
      }
      this.entry = entry;
      this.entryMonth = raw.monthKey;
      this.logger.info(
        {
          cacheFile: this.config.MONTHLY_CACHE_FILE,
          monthKey: raw.monthKey,
          totalEvents: entry.index.totalEvents,
          songs: entry.index.songs.size,
        },
        'monthly_cache_loaded',
      );
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code !== 'ENOENT') {
        this.logger.warn(
          {
            cacheFile: this.config.MONTHLY_CACHE_FILE,
            error: error instanceof Error ? error.message : String(error),
          },
          'monthly_cache_load_failed',
        );
      }
    }
  }

  private async persist(entry: CachedIndex, key: string): Promise<void> {
    const cacheFile = path.resolve(this.config.MONTHLY_CACHE_FILE);
    const directory = path.dirname(cacheFile);
    const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(
      temporaryFile,
      JSON.stringify(serialize(entry, key)),
      'utf8',
    );
    await rename(temporaryFile, cacheFile);
  }
}
