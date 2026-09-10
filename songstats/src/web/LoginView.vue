<script setup lang="ts">
import { ref } from 'vue';
import { login, submitTotp } from './api';

const emit = defineEmits<{ authenticated: [] }>();

const stage = ref<'credentials' | 'totp'>('credentials');
const username = ref('');
const password = ref('');
const totp = ref('');
const busy = ref(false);
const errorMessage = ref<string | null>(null);

function friendlyError(error: unknown): string {
  const obj = (error ?? {}) as { message?: unknown; detail?: unknown };
  const code = obj.message !== undefined ? String(obj.message) : String(error);
  const detail = obj.detail !== undefined ? String(obj.detail) : '';
  switch (code) {
    case 'invalid_credentials':
      return 'Benutzername oder Passwort ist falsch.';
    case 'invalid_code':
      return 'Der Einmal-Code ist ungültig oder abgelaufen.';
    case 'no_pending_totp':
      return 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.';
    case 'churchtools_unreachable':
      return detail
        ? `ChurchTools konnte nicht erreicht werden: ${detail}`
        : 'ChurchTools ist gerade nicht erreichbar. Bitte später erneut versuchen.';
    default:
      return 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.';
  }
}

async function submitCredentials(): Promise<void> {
  errorMessage.value = null;
  busy.value = true;
  try {
    const result = await login(username.value, password.value);
    if (result.status === 'totp_required') {
      stage.value = 'totp';
      totp.value = '';
    } else {
      emit('authenticated');
    }
  } catch (error) {
    errorMessage.value = friendlyError(error);
  } finally {
    busy.value = false;
  }
}

async function submitCode(): Promise<void> {
  errorMessage.value = null;
  busy.value = true;
  try {
    const result = await submitTotp(totp.value);
    if (result.status === 'ok') {
      emit('authenticated');
    } else {
      errorMessage.value = 'Der Einmal-Code ist ungültig oder abgelaufen.';
    }
  } catch (error) {
    errorMessage.value = friendlyError(error);
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      (error as { message: string }).message === 'no_pending_totp'
    ) {
      stage.value = 'credentials';
    }
  } finally {
    busy.value = false;
  }
}

function backToCredentials(): void {
  stage.value = 'credentials';
  totp.value = '';
  errorMessage.value = null;
}
</script>

<template>
  <div class="card narrow">
    <div class="header" style="border-bottom: 0; padding-bottom: 12px;">
      <div>
        <p class="eyebrow">Song-Statistiken</p>
        <h1>Anmelden mit ChurchTools</h1>
        <p class="intro">
          Melde dich mit deinem ChurchTools-Konto an, um zu sehen, wie oft ein Lied
          in den letzten Monaten in Events verwendet wurde.
        </p>
      </div>
    </div>

    <form
      v-if="stage === 'credentials'"
      class="form-stack"
      @submit.prevent="submitCredentials"
    >
      <label class="field">
        Benutzername oder E-Mail
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          required
          :disabled="busy"
        />
      </label>
      <label class="field">
        Passwort
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          :disabled="busy"
        />
      </label>
      <div class="actions">
        <button type="submit" class="button primary" :disabled="busy">
          <span v-if="busy" class="spinner small" aria-hidden="true"></span>
          {{ busy ? 'Anmelden…' : 'Anmelden' }}
        </button>
      </div>
    </form>

    <form v-else class="form-stack" @submit.prevent="submitCode">
      <p class="alert info">
        Für dieses Konto ist ein zweiter Faktor aktiviert. Bitte gib den aktuellen
        Einmal-Code aus deiner Authenticator-App ein.
      </p>
      <label class="field">
        Einmal-Code
        <input
          v-model="totp"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]*"
          minlength="4"
          maxlength="12"
          required
          :disabled="busy"
        />
      </label>
      <div class="actions">
        <button type="submit" class="button primary" :disabled="busy">
          <span v-if="busy" class="spinner small" aria-hidden="true"></span>
          {{ busy ? 'Prüfen…' : 'Bestätigen' }}
        </button>
        <button
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="backToCredentials"
        >
          Zurück
        </button>
      </div>
    </form>

    <p v-if="errorMessage" class="alert error">{{ errorMessage }}</p>
  </div>
</template>
