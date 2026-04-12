import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Schema — validates every environment variable the app depends on
// ---------------------------------------------------------------------------
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_TLS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // BullMQ
  BULL_REDIS_HOST: z.string().default('localhost'),
  BULL_REDIS_PORT: z.coerce.number().int().positive().default(6379),
  BULL_REDIS_PASSWORD: z.string().optional().default(''),
  BULL_REDIS_TLS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // Push Notifications
  APNS_KEY_ID: z.string().optional().default(''),
  APNS_TEAM_ID: z.string().optional().default(''),
  APNS_BUNDLE_ID: z.string().optional().default(''),
  FCM_SERVER_KEY: z.string().optional().default(''),

  // Metrics
  METRICS_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  METRICS_PORT: z.coerce.number().int().positive().default(9090),
});

export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Load .env manually (keeps us free from dotenv runtime dep)
// ---------------------------------------------------------------------------
function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Parse + freeze configuration object
// ---------------------------------------------------------------------------
loadDotEnv();

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

const env = parsed.data;

export const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',

  server: Object.freeze({
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
  }),

  database: Object.freeze({
    url: env.DATABASE_URL,
  }),

  redis: Object.freeze({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    tls: env.REDIS_TLS,
  }),

  jwt: Object.freeze({
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiry: env.JWT_ACCESS_EXPIRY,
    refreshExpiry: env.JWT_REFRESH_EXPIRY,
  }),

  cors: Object.freeze({
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
  }),

  rateLimit: Object.freeze({
    max: env.RATE_LIMIT_MAX,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
  }),

  bull: Object.freeze({
    redis: {
      host: env.BULL_REDIS_HOST,
      port: env.BULL_REDIS_PORT,
      password: env.BULL_REDIS_PASSWORD || undefined,
      tls: env.BULL_REDIS_TLS,
    },
  }),

  push: Object.freeze({
    apns: {
      keyId: env.APNS_KEY_ID,
      teamId: env.APNS_TEAM_ID,
      bundleId: env.APNS_BUNDLE_ID,
    },
    fcm: {
      serverKey: env.FCM_SERVER_KEY,
    },
  }),

  metrics: Object.freeze({
    enabled: env.METRICS_ENABLED,
    port: env.METRICS_PORT,
  }),
});

export type Config = typeof config;
