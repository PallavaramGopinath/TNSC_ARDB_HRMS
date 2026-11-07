import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { buildApiRouter } from './routes';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true, exposedHeaders: ['X-Correlation-Id', 'Content-Disposition'] }));
  app.use(express.json({ limit: '2mb' }));
  app.use(requestContext);
  app.use(pinoHttp({ logger, customProps: (req) => ({ correlationId: (req as express.Request).ctx?.correlationId }) }));

  app.use('/api', buildApiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
