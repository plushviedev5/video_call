import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

// ---------------------------------------------------------------------------
// Prometheus metrics registry
// ---------------------------------------------------------------------------

export const metricsRegistry = new Registry();

metricsRegistry.setDefaultLabels({
  service: 'video-calling-backend',
});

// Collect Node.js default metrics (CPU, memory, event loop, GC)
collectDefaultMetrics({ register: metricsRegistry });

// ---------------------------------------------------------------------------
// HTTP Metrics
// ---------------------------------------------------------------------------

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Socket Metrics
// ---------------------------------------------------------------------------

export const socketConnectionsGauge = new Gauge({
  name: 'socket_connections_active',
  help: 'Number of active Socket.IO connections',
  registers: [metricsRegistry],
});

export const socketEventsTotal = new Counter({
  name: 'socket_events_total',
  help: 'Total number of Socket.IO events processed',
  labelNames: ['event', 'status'] as const,
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Meeting Metrics
// ---------------------------------------------------------------------------

export const meetingJoinTotal = new Counter({
  name: 'meeting_join_total',
  help: 'Total meeting join attempts',
  labelNames: ['status'] as const, // 'success' | 'failure'
  registers: [metricsRegistry],
});

export const meetingJoinFailures = new Counter({
  name: 'meeting_join_failures_total',
  help: 'Total failed meeting join attempts',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

export const activeMeetingsGauge = new Gauge({
  name: 'meetings_active',
  help: 'Number of currently active meetings',
  registers: [metricsRegistry],
});

export const meetingParticipantsGauge = new Gauge({
  name: 'meeting_participants_active',
  help: 'Total active participants across all meetings',
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Auth Metrics
// ---------------------------------------------------------------------------

export const authAttemptsTotal = new Counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['type', 'status'] as const, // type: login|refresh, status: success|failure
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Chat Metrics
// ---------------------------------------------------------------------------

export const chatMessageLatency = new Histogram({
  name: 'chat_message_latency_seconds',
  help: 'Time from chat send to broadcast in seconds',
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [metricsRegistry],
});

export const chatMessagesTotal = new Counter({
  name: 'chat_messages_total',
  help: 'Total chat messages sent',
  registers: [metricsRegistry],
});

// ---------------------------------------------------------------------------
// Reconnect Metrics
// ---------------------------------------------------------------------------

export const reconnectTotal = new Counter({
  name: 'socket_reconnects_total',
  help: 'Total socket reconnection attempts',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});
