<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  SUPPORTED_FIELDS,
  VERIFIED_FIELD_KEY,
  effectiveVerificationDate,
  todayIso,
  type ExtensionSettings,
  type PersonRecord,
} from '@ct-details-updater/shared';
import {
  getCurrentUser,
  getMasterData,
  getPerson,
  getPersonId,
  initializeChurchToolsClient,
  isForbidden,
  updatePerson,
  type PersonFieldDefinition,
} from '@/api/churchtools';
import { loadSettings } from '@/api/kv-store';
import { showNotification } from '@/api/notifications';

const loading = ref(true);
const saving = ref(false);
const editing = ref(false);
const message = ref('');
const errorMessage = ref('');
const readOnly = ref(false);
const person = ref<PersonRecord | null>(null);
const settings = ref<ExtensionSettings | null>(null);
const masterFields = ref<PersonFieldDefinition[]>([]);
const form = reactive<Record<string, string>>({});

const configuredFields = computed(() => {
  const selected = new Set(settings.value?.fields ?? []);
  return SUPPORTED_FIELDS.filter((field) => selected.has(field.key)).map((field) => {
    const master = masterFields.value.find(
      (candidate) => candidate.key === field.key || candidate.column === field.key,
    );
    return {
      ...field,
      label: master?.nameTranslated || master?.name || field.label,
    };
  });
});

const lastVerified = computed(() => {
  if (!person.value) return 'Noch nicht bestätigt';
  const date = effectiveVerificationDate(person.value);
  return date
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(date)
    : 'Noch nicht bestätigt';
});

function populateForm(): void {
  if (!person.value) return;
  for (const field of configuredFields.value) {
    const value = person.value[field.key];
    form[field.key] = value == null ? '' : String(value);
  }
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    await initializeChurchToolsClient();
    const [user, loadedSettings, masterData] = await Promise.all([
      getCurrentUser(),
      loadSettings(),
      getMasterData(),
    ]);
    const loadedPerson = await getPerson(getPersonId(user));
    settings.value = loadedSettings;
    masterFields.value = masterData.personFields;
    person.value = loadedPerson;
    populateForm();
  } catch (error) {
    console.error(error);
    errorMessage.value =
      'Deine Daten konnten nicht geladen werden. Bitte versuche es später erneut.';
  } finally {
    loading.value = false;
  }
}

async function confirmCorrect(): Promise<void> {
  if (!person.value) return;
  await persist({ [VERIFIED_FIELD_KEY]: todayIso() });
}

async function saveChanges(): Promise<void> {
  if (!person.value) return;
  const updates = Object.fromEntries(
    configuredFields.value.map((field) => [field.key, form[field.key]?.trim() ?? '']),
  );
  updates[VERIFIED_FIELD_KEY] = todayIso();
  await persist(updates);
}

async function persist(updates: Record<string, unknown>): Promise<void> {
  if (!person.value) return;
  saving.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    person.value = await updatePerson(person.value.id, updates);
    editing.value = false;
    populateForm();
    message.value = 'Vielen Dank! Deine Daten wurden bestätigt.';
    showNotification(message.value, 'success');
  } catch (error) {
    console.error(error);
    if (isForbidden(error)) {
      readOnly.value = true;
      errorMessage.value =
        'Du hast keine Berechtigung, dein Profil zu ändern. Bitte wende dich an das Gemeindebüro.';
    } else {
      errorMessage.value =
        'Die Änderungen konnten nicht gespeichert werden. Bitte versuche es erneut.';
    }
    showNotification(errorMessage.value, 'error');
  } finally {
    saving.value = false;
  }
}

function cancelEditing(): void {
  populateForm();
  editing.value = false;
}

onMounted(load);
</script>

<template>
  <main class="page">
    <section class="card">
      <div v-if="loading" class="state" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <p>Deine Daten werden geladen …</p>
      </div>

      <template v-else-if="person">
        <header class="header">
          <div>
            <p class="eyebrow">Persönliche Daten</p>
            <h1>Hallo {{ person.firstName }}!</h1>
            <p class="intro">
              Bitte prüfe regelmäßig, ob wir dich noch unter den richtigen
              Kontaktdaten erreichen.
            </p>
          </div>
          <div class="verification">
            <span>Letzte Prüfung</span>
            <strong>{{ lastVerified }}</strong>
          </div>
        </header>

        <div v-if="message" class="alert success" role="status">{{ message }}</div>
        <div v-if="errorMessage" class="alert error" role="alert">
          {{ errorMessage }}
        </div>

        <form v-if="editing" class="fields" @submit.prevent="saveChanges">
          <label v-for="field in configuredFields" :key="field.key" class="field">
            <span>{{ field.label }}</span>
            <input
              v-model="form[field.key]"
              :type="field.type"
              :autocomplete="
                field.key === 'email'
                  ? 'email'
                  : field.key === 'mobile' || field.key.startsWith('phone')
                    ? 'tel'
                    : 'on'
              "
            />
          </label>

          <div class="actions">
            <button class="button primary" type="submit" :disabled="saving">
              {{ saving ? 'Wird gespeichert …' : 'Änderungen speichern' }}
            </button>
            <button class="button secondary" type="button" :disabled="saving" @click="cancelEditing">
              Abbrechen
            </button>
          </div>
        </form>

        <template v-else>
          <dl class="details">
            <div v-for="field in configuredFields" :key="field.key" class="detail">
              <dt>{{ field.label }}</dt>
              <dd>{{ person[field.key] || 'Nicht angegeben' }}</dd>
            </div>
          </dl>

          <div v-if="!readOnly" class="actions">
            <button class="button primary" type="button" :disabled="saving" @click="confirmCorrect">
              {{ saving ? 'Wird bestätigt …' : 'Alles korrekt' }}
            </button>
            <button class="button secondary" type="button" :disabled="saving" @click="editing = true">
              Daten ändern
            </button>
          </div>
        </template>

        <p class="privacy">
          Es wird nur gespeichert, wann du deine Angaben zuletzt geprüft hast.
          Deine Daten verbleiben in ChurchTools.
        </p>
      </template>

      <div v-else class="state">
        <h1>Daten konnten nicht geladen werden</h1>
        <p>{{ errorMessage }}</p>
        <button class="button secondary" type="button" @click="load">Erneut versuchen</button>
      </div>
    </section>
  </main>
</template>
