import { churchtoolsClient } from '@churchtools/churchtools-client';
import type { PersonRecord } from '@ct-details-updater/shared';

declare global {
  interface Window {
    settings?: {
      base_url?: string;
    };
  }
}

export interface WhoAmI extends PersonRecord {
  personId?: number;
}

export interface PersonFieldDefinition {
  key?: string;
  column?: string;
  name?: string;
  nameTranslated?: string;
  fieldTypeCode?: string;
  options?: Array<{ id: number; name: string }>;
}

export interface MasterData {
  personFields: PersonFieldDefinition[];
  statuses: Array<{ id: number; name: string }>;
  campuses: Array<{ id: number; name: string }>;
}

type ApiEnvelope<T> = T | { data: T };

function unwrap<T>(response: ApiEnvelope<T>): T {
  if (
    typeof response === 'object' &&
    response !== null &&
    'data' in response &&
    Object.keys(response).length <= 2
  ) {
    return (response as { data: T }).data;
  }
  return response as T;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'object' && value !== null) return Object.values(value) as T[];
  return [];
}

export async function initializeChurchToolsClient(): Promise<void> {
  const baseUrl = import.meta.env.DEV
    ? window.location.origin
    : window.settings?.base_url ??
      import.meta.env.VITE_BASE_URL ??
      window.location.origin;
  churchtoolsClient.setBaseUrl(baseUrl);

  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_USERNAME &&
    import.meta.env.VITE_PASSWORD
  ) {
    await churchtoolsClient.post('/login', {
      username: import.meta.env.VITE_USERNAME,
      password: import.meta.env.VITE_PASSWORD,
    });
  }
}

export async function getCurrentUser(): Promise<WhoAmI> {
  return unwrap(await churchtoolsClient.get<ApiEnvelope<WhoAmI>>('/whoami'));
}

export async function getPerson(personId: number): Promise<PersonRecord> {
  return unwrap(
    await churchtoolsClient.get<ApiEnvelope<PersonRecord>>(`/persons/${personId}`),
  );
}

export async function updatePerson(
  personId: number,
  updates: Record<string, unknown>,
): Promise<PersonRecord> {
  return unwrap(
    await churchtoolsClient.patch<ApiEnvelope<PersonRecord>>(
      `/persons/${personId}`,
      updates,
    ),
  );
}

export async function getMasterData(): Promise<MasterData> {
  const raw = unwrap(
    await churchtoolsClient.get<ApiEnvelope<Record<string, unknown>>>(
      '/person/masterdata',
    ),
  );

  const rawFields =
    raw.personFields ??
    raw.dbFields ??
    raw.fields ??
    (raw.person && typeof raw.person === 'object'
      ? (raw.person as Record<string, unknown>).fields
      : []);

  return {
    personFields: asArray<PersonFieldDefinition>(rawFields),
    statuses: asArray<{ id: number; name: string }>(
      raw.statuses ?? raw.personStatuses ?? raw.status,
    ),
    campuses: asArray<{ id: number; name: string }>(raw.campuses ?? raw.campus),
  };
}

export async function getAllPeople(): Promise<PersonRecord[]> {
  return churchtoolsClient.getAllPages<PersonRecord>('/persons', {
    is_archived: false,
  }, 100);
}

export function getPersonId(user: WhoAmI): number {
  const id = user.id ?? user.personId;
  if (!id) throw new Error('Die aktuelle Person konnte nicht ermittelt werden.');
  return id;
}

export function isForbidden(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    response?: { status?: number };
    status?: number;
  };
  return candidate.response?.status === 403 || candidate.status === 403;
}
