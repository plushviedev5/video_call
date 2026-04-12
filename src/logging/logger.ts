import pino from 'pino';
import { config } from '../config/index.js';

// ---------------------------------------------------------------------------
// Structured JSON logger (Pino)
// ---------------------------------------------------------------------------

/**
 * Root logger instance.
 * All modules should create child loggers via `logger.child({ module: 'xxx' })`.
 *
 * Sensitive fields (tokens, passwords) are automatically redacted.
 */
export const logger = pino({
  level: config.server.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact sensitive fields from appearing in logs
  redact: {
    paths: [
      'password',
      'refreshToken',
      'accessToken',
      'token',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'pushToken',
      'voipToken',
      '*.password',
      '*.refreshToken',
      '*.accessToken',
      '*.token',
    ],
    censor: '[REDACTED]',
  },

  // Structured serializers
  serializers: {
    req(request) {
      return {
        method: request.method,
        url: request.url,
        hostname: request.hostname,
        remoteAddress: request.ip,
        requestId: request.id,
      };
    },
    res(reply) {
      return {
        statusCode: reply.statusCode,
      };
    },
    err: pino.stdSerializers.err,
  },

  // Add environment context to every log line
  base: {
    env: config.env,
    service: 'video-calling-backend',
  },

  // Pretty print in development
  ...(config.isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,env,service',
      },
    },
  }),
});
