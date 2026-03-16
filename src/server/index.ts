import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env['PORT'] ?? '4680', 10);

async function main() {
  const server = Fastify({ logger: true });

  await server.register(cors, { origin: true });

  // Health check
  server.get('/api/health', async (_request, _reply) => {
    return { status: 'ok' };
  });

  // Static file serving for production builds
  // In production, dist/server/index.js is the entry point, so dist/client/ is at ../client
  const clientDistPath = path.resolve(__dirname, '..', 'client');

  if (fs.existsSync(clientDistPath)) {
    await server.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
    });

    // SPA fallback - serve index.html for non-API routes
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  await server.listen({ port: PORT, host: '0.0.0.0' });
  server.log.info(`Fleet Commander server listening on port ${PORT}`);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
