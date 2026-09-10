import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSongRoutes } from './routes/songs.js';
import { SessionStore } from './sessions.js';

const config = loadConfig();
const sessions = new SessionStore(config);

const app = Fastify({
  logger: { level: config.LOG_LEVEL },
});

await app.register(cookie, { secret: config.SESSION_SECRET });
await app.register(rateLimit, { global: false });

await registerAuthRoutes(app, { config, sessions });
await registerSongRoutes(app, { config, sessions });

app.get('/healthz', async () => ({ status: 'ok' }));

const webDir = resolveWebDir();
if (webDir) {
  app.log.info({ webDir }, 'serving_spa');
  await app.register(fastifyStatic, {
    root: webDir,
    prefix: '/',
    wildcard: false,
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/auth')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}

setInterval(() => sessions.sweep(), 5 * 60 * 1000).unref();

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

function resolveWebDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../web'),
    path.resolve(here, '../../dist/web'),
    path.resolve(here, '../../../songstats/dist/web'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}
