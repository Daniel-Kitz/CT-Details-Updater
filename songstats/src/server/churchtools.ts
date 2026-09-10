import type { Config } from './config.js';

export interface CookieJar {
  cookies: Map<string, string>;
}

export function createCookieJar(): CookieJar {
  return { cookies: new Map() };
}

function serializeCookies(jar: CookieJar): string {
  return Array.from(jar.cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function absorbSetCookie(jar: CookieJar, headers: Headers): void {
  const setCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : ([headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const raw of setCookies) {
    const [pair] = raw.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (!name) continue;
    if (value === '' || value === 'deleted') {
      jar.cookies.delete(name);
    } else {
      jar.cookies.set(name, value);
    }
  }
}

export class ChurchToolsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ChurchToolsError';
  }
}

export interface WhoAmIResponse {
  id: number;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export class ChurchToolsClient {
  constructor(
    private readonly config: Pick<Config, 'CHURCHTOOLS_BASE_URL'>,
    private readonly jar: CookieJar = createCookieJar(),
  ) {}

  get cookieJar(): CookieJar {
    return this.jar;
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const initialUrl = `${this.config.CHURCHTOOLS_BASE_URL}/api${path}`;
    const response = await this.fetchFollowingRedirects(initialUrl, init);

    if (response.status === 204) return undefined as T;

    const raw = await response.text();
    let body: unknown = raw;
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    if (!response.ok) {
      const message =
        (body && typeof body === 'object' && 'message' in body
          ? String((body as { message: unknown }).message)
          : null) ??
        `ChurchTools ${init.method ?? 'GET'} ${path} failed (${response.status})`;
      throw new ChurchToolsError(message, response.status, body);
    }

    return body as T;
  }

  private async fetchFollowingRedirects(
    url: string,
    init: RequestInit,
    maxHops = 5,
  ): Promise<Response> {
    let currentUrl = url;
    let currentInit: RequestInit = init;
    const startHost = new URL(url).host;

    for (let hop = 0; hop <= maxHops; hop += 1) {
      const headers = new Headers(currentInit.headers);
      headers.set('Accept', 'application/json');
      if (currentInit.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      const cookieHeader = serializeCookies(this.jar);
      if (cookieHeader) headers.set('Cookie', cookieHeader);

      const response = await fetch(currentUrl, {
        ...currentInit,
        headers,
        redirect: 'manual',
      });
      absorbSetCookie(this.jar, response.headers);

      const location = response.headers.get('location');
      if (
        !location ||
        response.status < 300 ||
        response.status >= 400 ||
        response.status === 304
      ) {
        return response;
      }

      const nextUrl = new URL(location, currentUrl);
      // Never carry credentials/body across host boundaries.
      if (nextUrl.host !== startHost) {
        throw new ChurchToolsError(
          `Refusing to follow cross-host redirect from ${currentUrl} to ${nextUrl.toString()}`,
          502,
          null,
        );
      }

      // Preserve method + body — otherwise a POST /api/login that hits an
      // HTTP→HTTPS or hostname-canonicalisation redirect would silently
      // downgrade to GET and never actually authenticate.
      currentUrl = nextUrl.toString();
      currentInit = { ...currentInit };
    }

    throw new ChurchToolsError(
      `Too many redirects when calling ${url}`,
      508,
      null,
    );
  }

  async login(username: string, password: string): Promise<LoginOutcome> {
    try {
      const raw = await this.request<unknown>('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      return interpretLogin(raw);
    } catch (error) {
      if (error instanceof ChurchToolsError && error.status === 401) {
        return { status: 'invalid' };
      }
      throw error;
    }
  }

  async loginWithTotp(personId: number, code: string): Promise<LoginOutcome> {
    const raw = await this.request<unknown>('/login/totp', {
      method: 'POST',
      body: JSON.stringify({ personId, code }),
    });
    return interpretLogin(raw);
  }

  async whoami(): Promise<WhoAmIResponse | null> {
    try {
      const raw = await this.request<{ data?: WhoAmIResponse } | WhoAmIResponse>(
        '/whoami',
      );
      const data =
        raw && typeof raw === 'object' && 'data' in raw
          ? (raw as { data?: WhoAmIResponse }).data
          : (raw as WhoAmIResponse);
      if (!data || typeof data.id !== 'number') return null;
      return data;
    } catch (error) {
      if (error instanceof ChurchToolsError && error.status === 401) {
        return null;
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.request<unknown>('/logout', { method: 'POST' });
    } catch {
      // Ignore — the session will time out on the CT side.
    }
  }
}

export type LoginOutcome =
  | { status: 'ok'; personId: number }
  | { status: 'totp_required'; personId: number }
  | { status: 'invalid' };

interface LoginResponseData {
  status?: string;
  personId?: number;
  data?: { personId?: number; status?: string };
}

function interpretLogin(raw: unknown): LoginOutcome {
  if (!raw || typeof raw !== 'object') return { status: 'invalid' };
  const outer = raw as LoginResponseData;
  const inner = outer.data ?? outer;
  const personId = Number(inner.personId ?? outer.personId);
  const status = String(inner.status ?? outer.status ?? '').toLowerCase();
  if (!personId) return { status: 'invalid' };
  if (status.includes('totp') || status.includes('2fa') || status.includes('needs')) {
    return { status: 'totp_required', personId };
  }
  return { status: 'ok', personId };
}
