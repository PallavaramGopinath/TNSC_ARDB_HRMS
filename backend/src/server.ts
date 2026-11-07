import { env } from './config/env';
import { db } from './config/db';
import { logger } from './config/logger';
import { buildApp } from './app';
import { enabledModules } from './modules/registry';

const server = buildApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT, modules: enabledModules().map((m) => m.key) }, 'TNSC ARDB HRMS API listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => void db.destroy().finally(() => process.exit(0)));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
