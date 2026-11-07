import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('TNSC.ARDB.HRMS'),
  JWT_AUDIENCE: z.string().default('TNSC.ARDB.HRMS.Client'),
  JWT_ACCESS_MINUTES: z.coerce.number().int().positive().default(60),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  CAPTCHA_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  MODULES_ENABLED: z
    .string()
    .default('hr,payroll')
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  FILE_STORAGE_ROOT: z.string().default('./storage'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
