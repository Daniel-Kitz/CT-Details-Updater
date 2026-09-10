<script setup lang="ts">
import { onMounted, ref } from 'vue';
import LoginView from './LoginView.vue';
import SearchView from './SearchView.vue';
import { me, type MeResponse } from './api';

const state = ref<'loading' | 'anonymous' | 'authenticated'>('loading');
const user = ref<MeResponse | null>(null);

async function refresh(): Promise<void> {
  state.value = 'loading';
  try {
    const response = await me();
    if (response) {
      user.value = response;
      state.value = 'authenticated';
    } else {
      user.value = null;
      state.value = 'anonymous';
    }
  } catch (error) {
    console.error(error);
    user.value = null;
    state.value = 'anonymous';
  }
}

function handleAuthenticated(): void {
  refresh();
}

function handleLoggedOut(): void {
  user.value = null;
  state.value = 'anonymous';
}

onMounted(refresh);
</script>

<template>
  <div class="page">
    <div v-if="state === 'loading'" class="state">
      <div class="spinner" aria-hidden="true"></div>
      <p>Sitzung wird geladen…</p>
    </div>
    <LoginView
      v-else-if="state === 'anonymous'"
      @authenticated="handleAuthenticated"
    />
    <SearchView
      v-else-if="state === 'authenticated' && user"
      :user="user"
      @logged-out="handleLoggedOut"
    />
  </div>
</template>
