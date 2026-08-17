import 'dotenv/config';
import { z } from 'zod';

function booleanString(defaultValue: 'true' | 'false') {
  return z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');
}

const configSchema = z.object({
  CHURCHTOOLS_BASE_URL: z.string().url().transform((value) => value.replace(/\/+$/, '')),
  CHURCHTOOLS_LOGIN_TOKEN: z.string().min(20),
  CHURCHTOOLS_MODULE_ID: z.coerce.number().int().positive().optional(),
  CHURCHTOOLS_SETTINGS_CATEGORY_ID: z.coerce.number().int().positive().optional(),
  CHURCHTOOLS_REMINDERS_CATEGORY_ID: z.coerce.number().int().positive().optional(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanString('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1),
  DRY_RUN: booleanString('true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'error']).default('info'),
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
