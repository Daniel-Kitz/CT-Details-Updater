import type { FastifyInstance } from 'fastify';
import {
  isValidRange,
  normalizeSongName,
  rangeForMonths,
  songMatchesQuery,
  type SongSuggestion,
  type SongUsage,
  type SongUsageResponse,
} from '@ct-details-updater/shared';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { SessionStore } from '../sessions.js';
import { getSessionFromRequest } from './auth.js';
import { ensureUsageIndex } from '../song-index.js';

const weekdaysSchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    const parts = value
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((part) => Number.isFinite(part));
    for (const day of parts) {
      if (day < 0 || day > 6) {
        ctx.addIssue({ code: 'custom', message: 'weekday must be 0-6' });
        return null;
      }
    }
    return parts.length === 0 ? null : parts;
  });

const usageQuerySchema = z
  .object({
    q: z.string().min(1),
    months: z.coerce.number().int().positive().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    weekdays: weekdaysSchema,
    limit: z.coerce.number().int().positive().max(50).default(10),
  })
  .refine(
    (value) => value.months !== undefined || (value.from && value.to),
    { message: 'either months or from+to must be provided' },
  );

const suggestQuerySchema = z.object({
  q: z.string().min(1),
  months: z.coerce.number().int().positive().default(3),
  weekdays: weekdaysSchema,
  limit: z.coerce.number().int().positive().max(20).default(8),
});

interface SongsDeps {
  config: Config;
  sessions: SessionStore;
}

export async function registerSongRoutes(
  app: FastifyInstance,
  deps: SongsDeps,
): Promise<void> {
  const { config } = deps;

  app.get('/api/song-usage', async (request, reply) => {
    const session = getSessionFromRequest(request, deps);
    if (!session) return reply.code(401).send({ error: 'not_authenticated' });

    const parsed = usageQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }

    const range =
      parsed.data.from && parsed.data.to
        ? { from: parsed.data.from, to: parsed.data.to }
        : rangeForMonths(parsed.data.months ?? 3);

    if (!isValidRange(range, config.MAX_RANGE_MONTHS)) {
      return reply.code(400).send({ error: 'invalid_range' });
    }

    const entry = await ensureUsageIndex(
      session,
      { from: range.from, to: range.to, weekdays: parsed.data.weekdays },
      { config, logger: request.log },
    );

    deps.sessions.extend(session);

    const query = parsed.data.q;
    const matches: SongUsage[] = [];
    for (const usage of entry.index.songs.values()) {
      if (songMatchesQuery(usage.title, query)) {
        matches.push(usage);
      }
    }
    matches.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.title.localeCompare(b.title);
    });

    const limited = matches.slice(0, parsed.data.limit);

    const response: SongUsageResponse = {
      range,
      totalEvents: entry.index.totalEvents,
      matches: limited,
    };
    return reply.send(response);
  });

  app.get('/api/songs/suggest', async (request, reply) => {
    const session = getSessionFromRequest(request, deps);
    if (!session) return reply.code(401).send({ error: 'not_authenticated' });

    const parsed = suggestQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query' });
    }

    const range = rangeForMonths(parsed.data.months);
    const entry = await ensureUsageIndex(
      session,
      { from: range.from, to: range.to, weekdays: parsed.data.weekdays },
      { config, logger: request.log },
    );

    const normalizedQuery = normalizeSongName(parsed.data.q);
    if (normalizedQuery === '') {
      return reply.send({ suggestions: [] });
    }

    const suggestions: Array<SongSuggestion & { count: number }> = [];
    for (const usage of entry.index.songs.values()) {
      if (normalizeSongName(usage.title).includes(normalizedQuery)) {
        suggestions.push({
          songId: usage.songId,
          title: usage.title,
          author: usage.author,
          count: usage.count,
        });
      }
    }
    suggestions.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.title.localeCompare(b.title);
    });

    return reply.send({ suggestions: suggestions.slice(0, parsed.data.limit) });
  });
}
