import Fastify from 'fastify';
import { Pool } from 'pg';
import { BlockchainService } from './services';

const fastify = Fastify({ logger: true });

async function bootstrap() {
  console.log('Bootstrapping...');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    connectionString: databaseUrl
  });

  const blockchainService = new BlockchainService(pool);
  await blockchainService.initialize();

  await blockchainService.routes.registerRoutes(fastify);

  console.log(`Current height: ${blockchainService.db.getCurrentHeight()}`);
}

try {
  await bootstrap();
  await fastify.listen({
    port: 3000,
    host: '0.0.0.0'
  })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
};
