import {
  EXTENSION_KEY,
  REMINDERS_CATEGORY,
  SETTINGS_CATEGORY,
  type ExtensionSettings,
  type PersonRecord,
  type ReminderState,
} from '@ct-details-updater/shared';
import type { Config } from './config.js';

interface CustomModule {
  id: number;
  shorty: string;
}

interface CustomDataCategory {
  id: number;
  shorty: string;
}

interface RawDataValue {
  id: number;
  dataCategoryId: number;
  value: string;
}

interface PaginationMeta {
  currentPage?: number;
  lastPage?: number;
  total?: number;
}

interface ApiPage<T> {
  data: T[];
  meta?: {
    pagination?: PaginationMeta;
  };
}

interface StorageIds {
  moduleId: number;
  settingsCategoryId: number;
  remindersCategoryId: number;
}

type PersonPageResponse =
  | PersonRecord[]
  | ApiPage<PersonRecord>
  | { data: ApiPage<PersonRecord> };

function unwrap<T>(response: T | { data: T }): T {
  if (typeof response === 'object' && response !== null && 'data' in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}

function normalizePersonPage(response: PersonPageResponse): ApiPage<PersonRecord> {
  if (Array.isArray(response)) return { data: response };
  if (Array.isArray(response.data)) return response as ApiPage<PersonRecord>;
  return response.data;
}

export class ChurchToolsApi {
  constructor(private readonly config: Config) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(
      `${this.config.CHURCHTOOLS_BASE_URL}/api${path}`,
      {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Login ${this.config.CHURCHTOOLS_LOGIN_TOKEN}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `ChurchTools ${init.method ?? 'GET'} ${path}: ${response.status} ${detail}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async getStorageIds(): Promise<StorageIds> {
    const modules = unwrap(
      await this.request<CustomModule[] | { data: CustomModule[] }>(
        '/custommodules',
      ),
    );
    const moduleId =
      this.config.CHURCHTOOLS_MODULE_ID ??
      modules.find((module) => module.shorty === EXTENSION_KEY)?.id;
    if (!moduleId) {
      throw new Error(`Custom Module "${EXTENSION_KEY}" wurde nicht gefunden.`);
    }

    const categories = unwrap(
      await this.request<
        CustomDataCategory[] | { data: CustomDataCategory[] }
      >(`/custommodules/${moduleId}/customdatacategories`),
    );
    const settingsCategoryId =
      this.config.CHURCHTOOLS_SETTINGS_CATEGORY_ID ??
      categories.find((category) => category.shorty === SETTINGS_CATEGORY)?.id;
    const remindersCategoryId =
      this.config.CHURCHTOOLS_REMINDERS_CATEGORY_ID ??
      categories.find((category) => category.shorty === REMINDERS_CATEGORY)?.id;

    if (!settingsCategoryId || !remindersCategoryId) {
      throw new Error(
        'Einstellungs- oder Erinnerungskategorie fehlt. Einstellungen einmal im Admin-Modul speichern.',
      );
    }
    return { moduleId, settingsCategoryId, remindersCategoryId };
  }

  async getSettings(ids: StorageIds): Promise<ExtensionSettings> {
    const values = await this.getRawValues(ids.moduleId, ids.settingsCategoryId);
    if (!values[0]) {
      throw new Error('Es wurden noch keine Einstellungen gespeichert.');
    }
    return JSON.parse(values[0].value) as ExtensionSettings;
  }

  async getReminderStates(ids: StorageIds): Promise<
    Array<ReminderState & { valueId: number }>
  > {
    const values = await this.getRawValues(ids.moduleId, ids.remindersCategoryId);
    return values.flatMap((entry) => {
      try {
        const parsed = JSON.parse(entry.value) as ReminderState;
        return [{ ...parsed, valueId: entry.id }];
      } catch {
        return [];
      }
    });
  }

  private async getRawValues(
    moduleId: number,
    categoryId: number,
  ): Promise<RawDataValue[]> {
    return unwrap(
      await this.request<RawDataValue[] | { data: RawDataValue[] }>(
        `/custommodules/${moduleId}/customdatacategories/${categoryId}/customdatavalues`,
      ),
    );
  }

  async saveReminderState(
    ids: StorageIds,
    state: ReminderState,
    valueId?: number,
  ): Promise<void> {
    const payload = JSON.stringify({
      dataCategoryId: ids.remindersCategoryId,
      value: JSON.stringify(state),
    });
    const basePath = `/custommodules/${ids.moduleId}/customdatacategories/${ids.remindersCategoryId}/customdatavalues`;

    await this.request(
      valueId ? `${basePath}/${valueId}` : basePath,
      {
        method: valueId ? 'PUT' : 'POST',
        body: payload,
      },
    );
  }

  async getAllPeople(): Promise<PersonRecord[]> {
    const people: PersonRecord[] = [];
    let page = 1;

    while (true) {
      const query = new URLSearchParams({
        page: String(page),
        limit: '100',
        is_archived: 'false',
      });
      const response = await this.request<PersonPageResponse>(`/persons?${query}`);
      const body = normalizePersonPage(response);
      const pagePeople = body.data;
      people.push(...pagePeople);

      const pagination = body.meta?.pagination;
      const lastPage = pagination?.lastPage;
      if (
        pagePeople.length === 0 ||
        (lastPage !== undefined && page >= lastPage) ||
        (lastPage === undefined && pagePeople.length < 100)
      ) {
        break;
      }
      page += 1;
    }

    return people;
  }
}

export type { StorageIds };
