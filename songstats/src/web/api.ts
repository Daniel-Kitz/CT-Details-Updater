import type {
  SongSuggestion,
  SongUsageResponse,
} from '@ct-details-updater/shared';

async function json<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: unknown = null;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  if (!response.ok) {
    const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const message =
      (bodyObj && 'error' in bodyObj ? String(bodyObj.error) : null) ??
      `HTTP ${response.status}`;
    const detail =
      bodyObj && 'detail' in bodyObj ? String(bodyObj.detail) : undefined;
    throw Object.assign(new Error(message), {
      status: response.status,
      body,
      detail,
    });
  }
  return body as T;
}

export type LoginResult =
  | { status: 'ok'; personId: number; displayName: string }
  | { status: 'totp_required' };

export interface MeResponse {
  personId: number;
  displayName: string;
  instanceUrl: string;
}

export interface SuggestSuggestion extends SongSuggestion {
  count: number;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function login(username: string, password: string): Promise<LoginResult> {
  const response = await fetch('/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ username, password }),
    credentials: 'include',
  });
  return json<LoginResult>(response);
}

export async function submitTotp(code: string): Promise<LoginResult> {
  const response = await fetch('/auth/totp', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ code }),
    credentials: 'include',
  });
  return json<LoginResult>(response);
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function me(): Promise<MeResponse | null> {
  const response = await fetch('/auth/me', { credentials: 'include' });
  if (response.status === 401) return null;
  return json<MeResponse>(response);
}

interface UsageQuery {
  q: string;
  months?: number;
  from?: string;
  to?: string;
  weekdays?: number[] | null;
}

function appendWeekdays(params: URLSearchParams, weekdays?: number[] | null): void {
  if (weekdays && weekdays.length > 0) {
    params.set('weekdays', weekdays.join(','));
  }
}

export async function fetchSongUsage(query: UsageQuery): Promise<SongUsageResponse> {
  const params = new URLSearchParams();
  params.set('q', query.q);
  if (query.months) params.set('months', String(query.months));
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  appendWeekdays(params, query.weekdays);
  const response = await fetch(`/api/song-usage?${params}`, { credentials: 'include' });
  return json<SongUsageResponse>(response);
}

export async function suggestSongs(
  q: string,
  months: number,
  weekdays?: number[] | null,
): Promise<SuggestSuggestion[]> {
  const params = new URLSearchParams({ q, months: String(months) });
  appendWeekdays(params, weekdays);
  const response = await fetch(`/api/songs/suggest?${params}`, { credentials: 'include' });
  const body = await json<{ suggestions: SuggestSuggestion[] }>(response);
  return body.suggestions;
}
