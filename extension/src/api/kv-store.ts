import { churchtoolsClient } from '@churchtools/churchtools-client';
import {
  DEFAULT_SETTINGS,
  EXTENSION_KEY,
  SETTINGS_CATEGORY,
  type ExtensionSettings,
} from '@ct-details-updater/shared';

export interface CustomModule {
  id: number;
  name: string;
  shorty: string;
  description?: string;
  sortKey: number;
}

export interface CustomDataCategory {
  id: number;
  customModuleId: number;
  name: string;
  shorty: string;
  description: string;
  data?: string;
}

export interface CustomDataValue<T> {
  id: number;
  dataCategoryId: number;
  value: T;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getModule(
  extensionKey = import.meta.env.VITE_KEY || EXTENSION_KEY,
): Promise<CustomModule> {
  const modules = await churchtoolsClient.get<CustomModule[]>('/custommodules');
  const module = modules.find((item) => item.shorty === extensionKey);
  if (!module) {
    throw new Error(`Erweiterung "${extensionKey}" wurde nicht gefunden.`);
  }
  return module;
}

export async function getCategories(
  moduleId: number,
): Promise<CustomDataCategory[]> {
  return churchtoolsClient.get<CustomDataCategory[]>(
    `/custommodules/${moduleId}/customdatacategories`,
  );
}

export async function ensureCategory(
  moduleId: number,
  shorty: string,
  name: string,
  description: string,
): Promise<CustomDataCategory> {
  const categories = await getCategories(moduleId);
  const existing = categories.find((category) => category.shorty === shorty);
  if (existing) return existing;

  return churchtoolsClient.post<CustomDataCategory>(
    `/custommodules/${moduleId}/customdatacategories`,
    {
      customModuleId: moduleId,
      name,
      shorty,
      description,
    },
  );
}

export async function getValues<T>(
  moduleId: number,
  categoryId: number,
): Promise<Array<CustomDataValue<T>>> {
  const values = await churchtoolsClient.get<
    Array<{ id: number; dataCategoryId: number; value: string }>
  >(
    `/custommodules/${moduleId}/customdatacategories/${categoryId}/customdatavalues`,
  );

  return values.map((entry) => ({
    ...entry,
    value: parseJson<T>(entry.value, {} as T),
  }));
}

export async function createValue<T>(
  moduleId: number,
  categoryId: number,
  value: T,
): Promise<void> {
  await churchtoolsClient.post(
    `/custommodules/${moduleId}/customdatacategories/${categoryId}/customdatavalues`,
    {
      dataCategoryId: categoryId,
      value: JSON.stringify(value),
    },
  );
}

export async function updateValue<T>(
  moduleId: number,
  categoryId: number,
  valueId: number,
  value: T,
): Promise<void> {
  await churchtoolsClient.put(
    `/custommodules/${moduleId}/customdatacategories/${categoryId}/customdatavalues/${valueId}`,
    {
      dataCategoryId: categoryId,
      value: JSON.stringify(value),
    },
  );
}

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const module = await getModule();
    const category = (await getCategories(module.id)).find(
      (item) => item.shorty === SETTINGS_CATEGORY,
    );
    if (!category) return { ...DEFAULT_SETTINGS };

    const values = await getValues<Partial<ExtensionSettings>>(module.id, category.id);
    const stored = values[0]?.value ?? {};
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      fields: stored.fields ?? [...DEFAULT_SETTINGS.fields],
      statusIds: stored.statusIds ?? [],
      campusIds: stored.campusIds ?? [],
    };
  } catch (error) {
    console.warn('Einstellungen konnten nicht geladen werden.', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const module = await getModule();
  const category = await ensureCategory(
    module.id,
    SETTINGS_CATEGORY,
    'Einstellungen',
    'Konfiguration für die regelmäßige Prüfung persönlicher Daten.',
  );
  const values = await getValues<ExtensionSettings>(module.id, category.id);
  if (values[0]) {
    await updateValue(module.id, category.id, values[0].id, settings);
  } else {
    await createValue(module.id, category.id, settings);
  }
}
