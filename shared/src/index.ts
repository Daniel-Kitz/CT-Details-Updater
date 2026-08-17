export const EXTENSION_KEY = 'ct-details-updater';
export const SETTINGS_CATEGORY = 'settings';
export const REMINDERS_CATEGORY = 'reminders';
export const VERIFIED_FIELD_KEY = 'dataVerifiedAt';

export const DEFAULT_FIELDS = [
  'street',
  'zip',
  'city',
  'email',
  'mobile',
  'phonePrivate',
  'birthday',
] as const;

export type SupportedFieldKey = (typeof SUPPORTED_FIELDS)[number]['key'];

export interface SupportedField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date';
}

export const SUPPORTED_FIELDS = [
  { key: 'street', label: 'Straße und Hausnummer', type: 'text' },
  { key: 'addressAddition', label: 'Adresszusatz', type: 'text' },
  { key: 'zip', label: 'Postleitzahl', type: 'text' },
  { key: 'city', label: 'Ort', type: 'text' },
  { key: 'country', label: 'Land', type: 'text' },
  { key: 'email', label: 'E-Mail-Adresse', type: 'email' },
  { key: 'mobile', label: 'Mobiltelefon', type: 'tel' },
  { key: 'phonePrivate', label: 'Telefon privat', type: 'tel' },
  { key: 'phoneWork', label: 'Telefon dienstlich', type: 'tel' },
  { key: 'birthday', label: 'Geburtsdatum', type: 'date' },
] as const satisfies readonly SupportedField[];

export interface ExtensionSettings {
  intervalMonths: number;
  fields: string[];
  statusIds: number[];
  campusIds: number[];
  reminderCadenceDays: number;
  maxReminders: number;
  emailSubject: string;
  emailBody: string;
  moduleUrl: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  intervalMonths: 6,
  fields: [...DEFAULT_FIELDS],
  statusIds: [],
  campusIds: [],
  reminderCadenceDays: 14,
  maxReminders: 3,
  emailSubject: 'Bitte prüfe deine persönlichen Daten',
  emailBody:
    'Hallo {{firstName}},\n\nbitte prüfe, ob deine persönlichen Daten in ChurchTools noch aktuell sind. Die letzte Bestätigung liegt länger als {{intervalMonths}} Monate zurück.\n\n{{moduleUrl}}\n\nVielen Dank!',
  moduleUrl: '',
};

export interface ReminderState {
  personId: number;
  lastReminderSentAt: string;
  reminderCount: number;
  verificationDateAtLastReminder: string | null;
}

export interface PersonRecord {
  id: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  statusId?: number | null;
  campusId?: number | null;
  lastEditedDate?: string | null;
  meta?: {
    modifiedDate?: string | null;
  };
  [key: string]: unknown;
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function effectiveVerificationDate(person: PersonRecord): Date | null {
  return (
    parseDate(person[VERIFIED_FIELD_KEY]) ??
    parseDate(person.lastEditedDate) ??
    parseDate(person.meta?.modifiedDate)
  );
}

export function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
}

export function isPersonOverdue(
  person: PersonRecord,
  settings: ExtensionSettings,
  now = new Date(),
): boolean {
  if (
    settings.statusIds.length > 0 &&
    (!person.statusId || !settings.statusIds.includes(person.statusId))
  ) {
    return false;
  }
  if (
    settings.campusIds.length > 0 &&
    (!person.campusId || !settings.campusIds.includes(person.campusId))
  ) {
    return false;
  }

  const verifiedAt = effectiveVerificationDate(person);
  return !verifiedAt || verifiedAt < subtractMonths(now, settings.intervalMonths);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function interpolateTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}
