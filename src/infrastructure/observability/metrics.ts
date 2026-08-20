import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/** One registry for the whole process; scraped through GET /metrics. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'visualizate_' });

export const renderJobsTotal = new Counter({
  name: 'visualizate_render_jobs_total',
  help: 'Finished render jobs by format and outcome',
  labelNames: ['format', 'status'] as const,
  registers: [registry],
});

export const renderDuration = new Histogram({
  name: 'visualizate_render_duration_seconds',
  help: 'Time spent rendering a piece',
  labelNames: ['format', 'status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 40],
  registers: [registry],
});

export const aiReviewsTotal = new Counter({
  name: 'visualizate_ai_reviews_total',
  help: 'AI review calls by outcome',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const aiReviewDuration = new Histogram({
  name: 'visualizate_ai_review_duration_seconds',
  help: 'Time spent waiting for the AI provider',
  labelNames: ['status'] as const,
  buckets: [1, 2, 5, 10, 20, 40, 60],
  registers: [registry],
});

export function recordRender(
  format: string,
  status: 'SUCCEEDED' | 'FAILED',
  durationMs: number,
) {
  renderJobsTotal.inc({ format, status });
  renderDuration.observe({ format, status }, durationMs / 1000);
}

export function recordAiReview(status: 'OK' | 'FAILED', durationMs: number) {
  aiReviewsTotal.inc({ status });
  aiReviewDuration.observe({ status }, durationMs / 1000);
}
