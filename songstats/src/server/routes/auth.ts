import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ChurchToolsClient, ChurchToolsError } from '../churchtools.js';
import type { Config } from '../config.js';
import {
  clientForSession,
  newJar,
  type Session,
  type SessionStore,
} from '../sessions.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const totpSchema = z.object({
  code: z.string().min(4).max(12),
});

interface AuthDeps {
  config: Config;
  sessions: SessionStore;
}

function setSessionCookie(reply: FastifyReply, config: Config, sid: string, ttlSeconds: number): void {
  reply.setCookie(config.COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    maxAge: ttlSeconds,
    signed: true,
  });
}

function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(config.COOKIE_NAME, { path: '/' });
}

function readSid(request: FastifyRequest, config: Config): string | undefined {
  const raw = request.cookies?.[config.COOKIE_NAME];
  if (!raw) return undefined;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value ?? undefined : undefined;
}

async function fetchDisplayName(client: ChurchToolsClient): Promise<string> {
  const me = await client.whoami();
  if (!me) return '';
  const parts = [me.firstName, me.lastName].filter(Boolean).join(' ').trim();
  return parts || me.email || '';
}

export function getSessionFromRequest(
  request: FastifyRequest,
  deps: AuthDeps,
): Session | null {
  const sid = readSid(request, deps.config);
  const session = deps.sessions.get(sid);
  if (!session || session.totpPending) return null;
  return session;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthDeps,
): Promise<void> {
  const { config, sessions } = deps;
  const ttlSeconds = Math.round(config.SESSION_TTL_HOURS * 60 * 60);

  app.post('/auth/login', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body' });
    }

    const jar = newJar();
    const client = new ChurchToolsClient(config, jar);
    let outcome;
    try {
      outcome = await client.login(parsed.data.username, parsed.data.password);
    } catch (error) {
      if (error instanceof ChurchToolsError) {
        request.log.warn(
          { status: error.status, detail: error.message },
          'login_upstream_error',
        );
        return reply.code(502).send({
          error: 'churchtools_unreachable',
          detail: error.message,
        });
      }
      throw error;
    }

    if (outcome.status === 'invalid') {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    if (outcome.status === 'totp_required') {
      const pending = sessions.createPendingTotp(outcome.personId, jar);
      setSessionCookie(reply, config, pending.id, 10 * 60);
      return reply.send({ status: 'totp_required' });
    }

    const displayName = await fetchDisplayName(client);
    const session = sessions.create(outcome.personId, displayName, jar);
    setSessionCookie(reply, config, session.id, ttlSeconds);
    return reply.send({
      status: 'ok',
      personId: session.personId,
      displayName: session.displayName,
    });
  });

  app.post('/auth/totp', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const sid = readSid(request, config);
    const session = sessions.get(sid);
    if (!session || !session.totpPending) {
      return reply.code(401).send({ error: 'no_pending_totp' });
    }
    const parsed = totpSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body' });
    }

    const client = clientForSession(config, session);
    let outcome;
    try {
      outcome = await client.loginWithTotp(session.totpPending.personId, parsed.data.code);
    } catch (error) {
      if (error instanceof ChurchToolsError && error.status === 401) {
        return reply.code(401).send({ error: 'invalid_code' });
      }
      throw error;
    }

    if (outcome.status !== 'ok') {
      return reply.code(401).send({ error: 'invalid_code' });
    }

    const displayName = await fetchDisplayName(client);
    sessions.promotePendingTotp(session, displayName);
    setSessionCookie(reply, config, session.id, ttlSeconds);
    return reply.send({
      status: 'ok',
      personId: session.personId,
      displayName: session.displayName,
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const sid = readSid(request, config);
    const session = sessions.get(sid);
    if (session) {
      const client = clientForSession(config, session);
      await client.logout();
      sessions.destroy(session.id);
    }
    clearSessionCookie(reply, config);
    return reply.send({ status: 'ok' });
  });

  app.get('/auth/me', async (request, reply) => {
    const session = getSessionFromRequest(request, deps);
    if (!session) {
      return reply.code(401).send({ error: 'not_authenticated' });
    }
    return reply.send({
      personId: session.personId,
      displayName: session.displayName,
      instanceUrl: config.CHURCHTOOLS_BASE_URL,
    });
  });
}
