import { randomBytes } from 'node:crypto';
import { ChurchToolsClient, type CookieJar, createCookieJar } from './churchtools.js';
import type { Config } from './config.js';
import type { UsageIndex } from './song-index.js';

export interface Session {
  id: string;
  jar: CookieJar;
  personId: number;
  displayName: string;
  expiresAt: number;
  totpPending?: { personId: number };
  cache: Map<string, CachedIndex>;
}

export interface CachedIndex {
  builtAt: number;
  from: string;
  to: string;
  index: UsageIndex;
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly config: Pick<Config, 'SESSION_TTL_HOURS'>) {}

  create(personId: number, displayName: string, jar: CookieJar): Session {
    const id = newSessionId();
    const session: Session = {
      id,
      jar,
      personId,
      displayName,
      expiresAt: Date.now() + this.config.SESSION_TTL_HOURS * 60 * 60 * 1000,
      cache: new Map(),
    };
    this.sessions.set(id, session);
    return session;
  }

  createPendingTotp(personId: number, jar: CookieJar): Session {
    const id = newSessionId();
    const session: Session = {
      id,
      jar,
      personId,
      displayName: '',
      expiresAt: Date.now() + 10 * 60 * 1000,
      totpPending: { personId },
      cache: new Map(),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string | undefined): Session | null {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  extend(session: Session): void {
    session.expiresAt = Date.now() + this.config.SESSION_TTL_HOURS * 60 * 60 * 1000;
  }

  promotePendingTotp(session: Session, displayName: string): void {
    session.displayName = displayName;
    session.totpPending = undefined;
    this.extend(session);
  }

  destroy(id: string): void {
    this.sessions.delete(id);
  }

  sweep(now = Date.now()): void {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(id);
    }
  }
}

export function clientForSession(
  config: Pick<Config, 'CHURCHTOOLS_BASE_URL'>,
  session: Session,
): ChurchToolsClient {
  return new ChurchToolsClient(config, session.jar);
}

export function newJar(): CookieJar {
  return createCookieJar();
}
