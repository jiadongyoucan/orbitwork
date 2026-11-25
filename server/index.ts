import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp({ logger: true });

const shutdown = async (signal: string) => {
  console.log(`[server] ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`[server] OrbitWork listening on http://${config.host}:${config.port}`);
  console.log(`[server] models: ${config.llm.modelsRaw}; demo=${!config.llm.apiKey}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
