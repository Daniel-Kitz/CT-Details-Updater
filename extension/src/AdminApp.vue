<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  DEFAULT_SETTINGS,
  REMINDERS_CATEGORY,
  SUPPORTED_FIELDS,
  effectiveVerificationDate,
  isPersonOverdue,
  type ExtensionSettings,
  type PersonRecord,
} from '@ct-details-updater/shared';
import {
  getAllPeople,
  getMasterData,
  initializeChurchToolsClient,
} from '@/api/churchtools';
import {
  ensureCategory,
  getModule,
  loadSettings,
  saveSettings,
} from '@/api/kv-store';
import { showNotification } from '@/api/notifications';

const loading = ref(true);
const saving = ref(false);
const loadingPeople = ref(false);
const message = ref('');
const errorMessage = ref('');
const people = ref<PersonRecord[]>([]);
const statuses = ref<Array<{ id: number; name: string }>>([]);
const campuses = ref<Array<{ id: number; name: string }>>([]);
const form = reactive<ExtensionSettings>({ ...DEFAULT_SETTINGS });

const overduePeople = computed(() =>
  people.value
    .filter((person) => isPersonOverdue(person, form))
    .sort((a, b) => {
      const aDate = effectiveVerificationDate(a)?.getTime() ?? 0;
      const bDate = effectiveVerificationDate(b)?.getTime() ?? 0;
      return aDate - bDate;
    }),
);

function assignSettings(settings: ExtensionSettings): void {
  Object.assign(form, {
    ...settings,
    fields: [...settings.fields],
    statusIds: [...settings.statusIds],
    campusIds: [...settings.campusIds],
  });
}

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    await initializeChurchToolsClient();
    const [settings, masterData] = await Promise.all([
      loadSettings(),
      getMasterData(),
    ]);
    assignSettings(settings);
    statuses.value = masterData.statuses;
    campuses.value = masterData.campuses;
  } catch (error) {
    console.error(error);
    errorMessage.value =
      'Die Einstellungen konnten nicht geladen werden. Prüfe deine Administratorrechte.';
  } finally {
    loading.value = false;
  }
}

async function persist(): Promise<void> {
  saving.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    await saveSettings({
      ...form,
      fields: [...form.fields],
      statusIds: form.statusIds.map(Number),
      campusIds: form.campusIds.map(Number),
    });
    const module = await getModule();
    await ensureCategory(
      module.id,
      REMINDERS_CATEGORY,
      'Erinnerungen',
      'Versandstatus der Erinnerungen je Person.',
    );
    message.value = 'Die Einstellungen wurden gespeichert.';
    showNotification(message.value, 'success');
  } catch (error) {
    console.error(error);
    errorMessage.value =
      'Die Einstellungen konnten nicht gespeichert werden. Prüfe die Berechtigungen für Erweiterungen.';
    showNotification(errorMessage.value, 'error');
  } finally {
    saving.value = false;
  }
}

async function loadOverduePeople(): Promise<void> {
  loadingPeople.value = true;
  errorMessage.value = '';
  try {
    people.value = await getAllPeople();
  } catch (error) {
    console.error(error);
    errorMessage.value =
      'Die Personenliste konnte nicht geladen werden. Dafür wird die Berechtigung zum Lesen der betroffenen Personen benötigt.';
  } finally {
    loadingPeople.value = false;
  }
}

function formatDate(person: PersonRecord): string {
  const date = effectiveVerificationDate(person);
  return date
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date)
    : 'Nie';
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function exportCsv(): void {
  const header = ['Person-ID', 'Vorname', 'Nachname', 'E-Mail', 'Letzte Prüfung'];
  const rows = overduePeople.value.map((person) => [
    person.id,
    person.firstName,
    person.lastName,
    person.email ?? '',
    formatDate(person),
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ueberfaellige-datenpruefung-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(load);
</script>

<template>
  <main class="page">
    <section class="card admin-card">
      <div v-if="loading" class="state">
        <span class="spinner" aria-hidden="true"></span>
        <p>Einstellungen werden geladen …</p>
      </div>

      <template v-else>
        <header class="header">
          <div>
            <p class="eyebrow">ChurchTools Details Updater</p>
            <h1>Einstellungen</h1>
            <p class="intro">
              Lege fest, wann und für welche Personen die Datenprüfung fällig ist.
              Der Reminder-Dienst liest diese Konfiguration bei jedem Lauf.
            </p>
          </div>
        </header>

        <div v-if="message" class="alert success" role="status">{{ message }}</div>
        <div v-if="errorMessage" class="alert error" role="alert">{{ errorMessage }}</div>

        <form @submit.prevent="persist">
          <section class="section">
            <h2>Prüfintervall</h2>
            <div class="settings-grid">
              <label class="field">
                <span>Intervall in Monaten</span>
                <input v-model.number="form.intervalMonths" type="number" min="1" max="60" required />
              </label>
              <label class="field">
                <span>Abstand zwischen Erinnerungen (Tage)</span>
                <input v-model.number="form.reminderCadenceDays" type="number" min="1" max="365" required />
              </label>
              <label class="field">
                <span>Maximale Anzahl Erinnerungen</span>
                <input v-model.number="form.maxReminders" type="number" min="1" max="20" required />
              </label>
              <label class="field">
                <span>Link zum Erweiterungsmodul</span>
                <input
                  v-model.trim="form.moduleUrl"
                  type="url"
                  placeholder="https://deine-gemeinde.church.tools/ccm/ct-details-updater"
                  required
                />
              </label>
            </div>
          </section>

          <section class="section">
            <h2>Zu prüfende Felder</h2>
            <div class="check-grid">
              <label v-for="field in SUPPORTED_FIELDS" :key="field.key" class="check">
                <input v-model="form.fields" type="checkbox" :value="field.key" />
                <span>{{ field.label }}</span>
              </label>
            </div>
          </section>

          <section class="section">
            <h2>Personenkreis</h2>
            <div class="settings-grid">
              <label class="field">
                <span>Status (leer = alle)</span>
                <select v-model="form.statusIds" multiple size="6">
                  <option v-for="status in statuses" :key="status.id" :value="status.id">
                    {{ status.name }}
                  </option>
                </select>
              </label>
              <label class="field">
                <span>Campus (leer = alle)</span>
                <select v-model="form.campusIds" multiple size="6">
                  <option v-for="campus in campuses" :key="campus.id" :value="campus.id">
                    {{ campus.name }}
                  </option>
                </select>
              </label>
            </div>
            <p class="hint">Mehrere Einträge mit gedrückter Strg-/Cmd-Taste auswählen.</p>
          </section>

          <section class="section">
            <h2>Erinnerungs-E-Mail</h2>
            <div class="settings-grid">
              <label class="field full">
                <span>Betreff</span>
                <input v-model.trim="form.emailSubject" required />
              </label>
              <label class="field full">
                <span>Text</span>
                <textarea v-model="form.emailBody" required></textarea>
              </label>
            </div>
            <p v-pre class="hint">
              Verfügbare Platzhalter: <code>{{firstName}}</code>,
              <code>{{lastName}}</code>, <code>{{intervalMonths}}</code>,
              <code>{{moduleUrl}}</code>.
            </p>
          </section>

          <div class="actions">
            <button class="button primary" type="submit" :disabled="saving">
              {{ saving ? 'Wird gespeichert …' : 'Einstellungen speichern' }}
            </button>
          </div>
        </form>

        <section class="section">
          <div class="toolbar">
            <div>
              <h2>Überfällige Personen</h2>
              <span v-if="people.length" class="muted">{{ overduePeople.length }} Personen</span>
            </div>
            <div class="actions">
              <button class="button secondary" type="button" :disabled="loadingPeople" @click="loadOverduePeople">
                {{ loadingPeople ? 'Wird geladen …' : 'Liste laden' }}
              </button>
              <button
                v-if="overduePeople.length"
                class="button secondary"
                type="button"
                @click="exportCsv"
              >
                CSV exportieren
              </button>
            </div>
          </div>

          <div v-if="overduePeople.length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>E-Mail</th>
                  <th>Letzte Prüfung</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="person in overduePeople" :key="person.id">
                  <td>{{ person.firstName }} {{ person.lastName }}</td>
                  <td>{{ person.email || 'Keine E-Mail' }}</td>
                  <td>{{ formatDate(person) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="people.length" class="muted">Niemand ist aktuell überfällig.</p>
        </section>
      </template>
    </section>
  </main>
</template>
