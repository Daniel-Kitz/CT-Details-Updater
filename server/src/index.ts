import {
  effectiveVerificationDate,
  isPersonOverdue,
  type ReminderState,
} from '@ct-details-updater/shared';
import { ChurchToolsApi } from './churchtools-api.js';
import { loadConfig } from './config.js';
import { Mailer } from './mailer.js';

function log(
  level: 'info' | 'error',
  event: string,
  data: Record<string, unknown> = {},
): void {
  const target = level === 'error' ? console.error : console.log;
  target(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data,
    }),
  );
}

function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000);
}

async function run(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  const api = new ChurchToolsApi(config);
  const mailer = new Mailer(config);
  const now = new Date();

  log('info', 'reminder_run_started', { dryRun: config.DRY_RUN });

  const storageIds = await api.getStorageIds();
  const [settings, people, savedStates] = await Promise.all([
    api.getSettings(storageIds),
    api.getAllPeople(),
    api.getReminderStates(storageIds),
  ]);
  const states = new Map(savedStates.map((state) => [state.personId, state]));

  let overdue = 0;
  let sent = 0;
  let skippedNoEmail = 0;
  let skippedCadence = 0;
  let skippedMaximum = 0;
  let failed = 0;

  for (const person of people) {
    if (!isPersonOverdue(person, settings, now)) continue;
    overdue += 1;

    if (!person.email || typeof person.email !== 'string') {
      skippedNoEmail += 1;
      continue;
    }

    const verificationDate =
      effectiveVerificationDate(person)?.toISOString() ?? null;
    const existing = states.get(person.id);
    const verificationChanged =
      existing?.verificationDateAtLastReminder !== verificationDate;
    const reminderCount = verificationChanged ? 0 : (existing?.reminderCount ?? 0);

    if (reminderCount >= settings.maxReminders) {
      skippedMaximum += 1;
      continue;
    }

    if (
      existing &&
      !verificationChanged &&
      daysBetween(new Date(existing.lastReminderSentAt), now) <
        settings.reminderCadenceDays
    ) {
      skippedCadence += 1;
      continue;
    }

    const message = mailer.createMessage(person, settings);
    if (config.DRY_RUN) {
      log('info', 'reminder_dry_run', {
        personId: person.id,
        recipient: person.email,
      });
      sent += 1;
      continue;
    }

    try {
      await mailer.send(message);
      const state: ReminderState = {
        personId: person.id,
        lastReminderSentAt: now.toISOString(),
        reminderCount: reminderCount + 1,
        verificationDateAtLastReminder: verificationDate,
      };
      await api.saveReminderState(storageIds, state, existing?.valueId);
      sent += 1;
      log('info', 'reminder_sent', {
        personId: person.id,
        reminderCount: state.reminderCount,
      });
    } catch (error) {
      failed += 1;
      log('error', 'reminder_failed', {
        personId: person.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log('info', 'reminder_run_finished', {
    durationMs: Date.now() - startedAt,
    people: people.length,
    overdue,
    sent,
    skippedNoEmail,
    skippedCadence,
    skippedMaximum,
    failed,
    dryRun: config.DRY_RUN,
  });

  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  log('error', 'reminder_run_crashed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
