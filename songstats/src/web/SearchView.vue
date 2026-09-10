<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { SongUsageResponse } from '@ct-details-updater/shared';
import {
  fetchSongUsage,
  logout,
  suggestSongs,
  type MeResponse,
  type SuggestSuggestion,
} from './api';

const props = defineProps<{ user: MeResponse }>();
const emit = defineEmits<{ loggedOut: [] }>();

type RangeMode = 1 | 3 | 6 | 12 | 'custom';
type WeekdayMode = 'all' | 'sunday' | 'custom';

const WEEKDAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mo' },
  { value: 2, label: 'Di' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' },
  { value: 5, label: 'Fr' },
  { value: 6, label: 'Sa' },
  { value: 0, label: 'So' },
];

const query = ref('');
const range = ref<RangeMode>(3);
const customFrom = ref<string>('');
const customTo = ref<string>('');
const weekdayMode = ref<WeekdayMode>('all');
const selectedWeekdays = ref<number[]>([]);
const busy = ref(false);
const errorMessage = ref<string | null>(null);
const result = ref<SongUsageResponse | null>(null);
const submittedQuery = ref<string>('');

const effectiveWeekdays = computed<number[] | null>(() => {
  if (weekdayMode.value === 'sunday') return [0];
  if (weekdayMode.value === 'custom' && selectedWeekdays.value.length > 0) {
    return [...selectedWeekdays.value];
  }
  return null;
});

function toggleWeekday(day: number): void {
  const idx = selectedWeekdays.value.indexOf(day);
  if (idx >= 0) selectedWeekdays.value.splice(idx, 1);
  else selectedWeekdays.value.push(day);
}

const suggestions = ref<SuggestSuggestion[]>([]);
const suggestionsOpen = ref(false);
const suggestActiveIndex = ref(-1);
let suggestTimer: ReturnType<typeof setTimeout> | null = null;
let suggestRequestId = 0;

const rangeOptions: Array<{ value: RangeMode; label: string }> = [
  { value: 1, label: '1 Monat' },
  { value: 3, label: '3 Monate' },
  { value: 6, label: '6 Monate' },
  { value: 12, label: '12 Monate' },
  { value: 'custom', label: 'Zeitraum wählen' },
];

const rangeMonths = computed<number>(() =>
  typeof range.value === 'number' ? range.value : 3,
);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function initCustomRange(): void {
  if (!customTo.value) customTo.value = todayIso();
  if (!customFrom.value) customFrom.value = monthsAgoIso(3);
}

watch(range, (mode) => {
  if (mode === 'custom') initCustomRange();
});

// Auto-refresh the visible result when the range or weekday filter changes so
// the numbers on screen always reflect the current selection.
watch(
  [range, customFrom, customTo, effectiveWeekdays],
  () => {
    if (!submittedQuery.value) return;
    if (range.value === 'custom' && (!customFrom.value || !customTo.value)) return;
    runSearch();
  },
  { deep: true },
);

const rangeLabel = computed(() => {
  if (range.value === 'custom') {
    if (customFrom.value && customTo.value) {
      return `${formatDate(customFrom.value)} – ${formatDate(customTo.value)}`;
    }
    return 'Individueller Zeitraum';
  }
  const opt = rangeOptions.find((option) => option.value === range.value);
  return opt?.label ?? '';
});

function formatDate(value: string | undefined | null): string {
  if (!value) return '—';
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return value;
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function friendlyError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  switch (code) {
    case 'not_authenticated':
      return 'Sitzung abgelaufen. Bitte erneut anmelden.';
    case 'invalid_range':
      return 'Der gewählte Zeitraum ist ungültig oder zu groß.';
    case 'invalid_query':
      return 'Bitte gib einen Suchbegriff ein.';
    default:
      return 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.';
  }
}

function currentRangeParams(): {
  months?: number;
  from?: string;
  to?: string;
  weekdays: number[] | null;
} {
  const weekdays = effectiveWeekdays.value;
  if (range.value === 'custom') {
    return { from: customFrom.value, to: customTo.value, weekdays };
  }
  return { months: range.value, weekdays };
}

async function runSearch(): Promise<void> {
  if (!query.value.trim()) {
    errorMessage.value = 'Bitte gib einen Songnamen ein.';
    return;
  }
  errorMessage.value = null;
  busy.value = true;
  suggestionsOpen.value = false;
  try {
    const response = await fetchSongUsage({
      q: query.value.trim(),
      ...currentRangeParams(),
    });
    result.value = response;
    submittedQuery.value = query.value.trim();
  } catch (error) {
    errorMessage.value = friendlyError(error);
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      (error as { message: string }).message === 'not_authenticated'
    ) {
      emit('loggedOut');
    }
  } finally {
    busy.value = false;
  }
}

function refreshSuggestions(term: string): void {
  if (suggestTimer) clearTimeout(suggestTimer);
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    suggestions.value = [];
    suggestionsOpen.value = false;
    return;
  }
  const requestId = ++suggestRequestId;
  suggestTimer = setTimeout(async () => {
    try {
      const items = await suggestSongs(
        trimmed,
        rangeMonths.value,
        effectiveWeekdays.value,
      );
      if (requestId !== suggestRequestId) return;
      suggestions.value = items;
      suggestionsOpen.value = items.length > 0;
      suggestActiveIndex.value = -1;
    } catch {
      // Silently ignore — search will surface real errors.
    }
  }, 250);
}

function onQueryInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  query.value = value;
  refreshSuggestions(value);
}

function selectSuggestion(item: SuggestSuggestion): void {
  query.value = item.title;
  suggestionsOpen.value = false;
  runSearch();
}

function handleSuggestionKey(event: KeyboardEvent): void {
  if (!suggestionsOpen.value || suggestions.value.length === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    suggestActiveIndex.value =
      (suggestActiveIndex.value + 1) % suggestions.value.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    suggestActiveIndex.value =
      (suggestActiveIndex.value - 1 + suggestions.value.length) %
      suggestions.value.length;
  } else if (event.key === 'Enter' && suggestActiveIndex.value >= 0) {
    event.preventDefault();
    selectSuggestion(suggestions.value[suggestActiveIndex.value]);
  } else if (event.key === 'Escape') {
    suggestionsOpen.value = false;
  }
}

function closeSuggestionsSoon(): void {
  setTimeout(() => {
    suggestionsOpen.value = false;
  }, 120);
}

async function signOut(): Promise<void> {
  await logout();
  emit('loggedOut');
}

onBeforeUnmount(() => {
  if (suggestTimer) clearTimeout(suggestTimer);
});
</script>

<template>
  <div class="card">
    <div class="header">
      <div>
        <p class="eyebrow">Song-Statistiken</p>
        <h1>Wie oft wurde ein Lied gesungen?</h1>
        <p class="intro">
          Suche nach einem Song und du siehst, wie oft und in welchen Events das
          Lied im gewählten Zeitraum gespielt wurde. Die Auswertung wird direkt aus
          den Event-Agenden deiner ChurchTools-Instanz erstellt.
        </p>
      </div>
      <div class="user-chip">
        <span>Angemeldet als</span>
        <strong>{{ props.user.displayName || `Person #${props.user.personId}` }}</strong>
        <button type="button" class="button link" @click="signOut">Abmelden</button>
      </div>
    </div>

    <form class="search" @submit.prevent="runSearch">
      <div class="search-row">
        <label class="field suggestions">
          Songname
          <input
            type="text"
            :value="query"
            placeholder="z. B. 10.000 Reasons"
            autocomplete="off"
            :disabled="busy"
            @input="onQueryInput"
            @keydown="handleSuggestionKey"
            @focus="suggestionsOpen = suggestions.length > 0"
            @blur="closeSuggestionsSoon"
          />
          <ul
            v-if="suggestionsOpen && suggestions.length"
            class="suggestion-list"
            role="listbox"
          >
            <li
              v-for="(item, index) in suggestions"
              :key="item.songId"
              :class="{ active: index === suggestActiveIndex }"
              @mousedown.prevent="selectSuggestion(item)"
            >
              <span>{{ item.title }}</span>
              <span class="suggestion-count">{{ item.count }}×</span>
            </li>
          </ul>
        </label>

        <div class="field">
          Zeitraum
          <div class="range-selector">
            <button
              v-for="option in rangeOptions"
              :key="String(option.value)"
              type="button"
              class="pill"
              :class="{ active: range === option.value }"
              :disabled="busy"
              @click="range = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="actions" style="justify-content: flex-end">
          <button type="submit" class="button primary" :disabled="busy">
            <span v-if="busy" class="spinner small" aria-hidden="true"></span>
            {{ busy ? 'Suche läuft…' : 'Suchen' }}
          </button>
        </div>
      </div>

      <div v-if="range === 'custom'" class="custom-range">
        <label class="field">
          Von
          <input type="date" v-model="customFrom" :disabled="busy" required />
        </label>
        <label class="field">
          Bis
          <input type="date" v-model="customTo" :disabled="busy" required />
        </label>
      </div>

      <div class="weekday-filter">
        <span class="weekday-label">Wochentage</span>
        <div class="range-selector">
          <button
            type="button"
            class="pill"
            :class="{ active: weekdayMode === 'all' }"
            :disabled="busy"
            @click="weekdayMode = 'all'"
          >
            Alle Tage
          </button>
          <button
            type="button"
            class="pill"
            :class="{ active: weekdayMode === 'sunday' }"
            :disabled="busy"
            title="Nur Events an Sonntagen berücksichtigen (deutlich schneller)"
            @click="weekdayMode = 'sunday'"
          >
            Nur Sonntage
          </button>
          <button
            type="button"
            class="pill"
            :class="{ active: weekdayMode === 'custom' }"
            :disabled="busy"
            @click="weekdayMode = 'custom'"
          >
            Auswählen…
          </button>
        </div>
        <div v-if="weekdayMode === 'custom'" class="weekday-picker">
          <label
            v-for="option in WEEKDAY_LABELS"
            :key="option.value"
            class="weekday-check"
          >
            <input
              type="checkbox"
              :checked="selectedWeekdays.includes(option.value)"
              :disabled="busy"
              @change="toggleWeekday(option.value)"
            />
            {{ option.label }}
          </label>
        </div>
      </div>
    </form>

    <p v-if="errorMessage" class="alert error">{{ errorMessage }}</p>

    <div v-if="busy && !result" class="state">
      <div class="spinner" aria-hidden="true"></div>
      <p>
        Event-Agenden werden ausgelesen. Beim ersten Aufruf pro Zeitraum kann das
        einen Moment dauern.
      </p>
    </div>

    <section v-if="result" class="result">
      <template v-if="result.matches.length === 0">
        <h2 class="result-headline">Keine Treffer</h2>
        <p class="result-sub">
          Für „{{ submittedQuery }}“ wurde im Zeitraum {{ rangeLabel }} kein Lied in den
          {{ result.totalEvents }} durchsuchten Events gefunden.
        </p>
      </template>
      <template v-else>
        <h2 class="result-headline">
          {{
            result.matches.length === 1
              ? `${result.matches[0].count}× gespielt`
              : `${result.matches.length} Treffer`
          }}
        </h2>
        <p class="result-sub">
          Zeitraum {{ formatDate(result.range.from) }} – {{ formatDate(result.range.to) }},
          {{ result.totalEvents }} Events durchsucht.
        </p>

        <div class="result-list">
          <article
            v-for="song in result.matches"
            :key="song.songId"
            class="song-block"
          >
            <h3>{{ song.title }}</h3>
            <p class="song-meta">
              {{ song.count }}× in diesem Zeitraum verwendet.
            </p>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Event</th>
                    <th>Kalender</th>
                    <th>Arrangement</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(occurrence, index) in song.occurrences"
                    :key="`${occurrence.eventId}-${index}`"
                  >
                    <td>{{ formatDate(occurrence.eventStartDate) }}</td>
                    <td>{{ occurrence.eventName }}</td>
                    <td>
                      <span v-if="occurrence.calendarName">
                        {{ occurrence.calendarName }}
                      </span>
                      <span v-else class="muted">—</span>
                    </td>
                    <td>
                      <span v-if="occurrence.arrangementName">
                        {{ occurrence.arrangementName }}
                      </span>
                      <span v-else class="muted">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>
      </template>
    </section>
  </div>
</template>
