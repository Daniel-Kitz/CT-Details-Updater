import 'dotenv/config';
import { z } from 'zod';

function booleanString(defaultValue: 'true' | 'false') {
  return z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');
}

const configSchema = z.object({
  CHURCHTOOLS_BASE_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),
  PORT: z.coerce.number().int().positive().default(5175),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  CACHE_TTL_MINUTES: z.coerce.number().positive().default(15),
  MAX_RANGE_MONTHS: z.coerce.number().int().positive().default(24),
  AGENDA_CONCURRENCY: z.coerce.number().int().positive().max(20).default(5),
  CHURCHTOOLS_LOGIN_TOKEN: z.string().min(20).optional(),
  MONTHLY_CACHE_FILE: z.string().min(1).default('.cache/songstats-cache.json'),
  MONTHLY_CACHE_CHECK_MINUTES: z.coerce.number().int().positive().default(60),
  COOKIE_SECURE: booleanString('true'),
  COOKIE_NAME: z.string().min(1).default('songstats_sid'),
  SESSION_SECRET: z.string().min(32),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Ungültige Konfiguration: ${errors}`);
  }
  return result.data;
}
