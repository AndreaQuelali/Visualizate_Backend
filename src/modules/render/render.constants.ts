export const RENDER_QUEUE = 'render';

/** Total attempts per job (1 try + 2 retries for transient errors). */
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = 2000;

/** Maximum time a single render may take. */
export const RENDER_TIMEOUT_MS = 30_000;

export const ALLOWED_SCALES = [1, 2, 3] as const;

/** Chromium cannot reliably capture beyond these sizes. */
export const MAX_OUTPUT_SIDE = 16_384;
export const MAX_OUTPUT_PIXELS = 64_000_000;

/** PNGs heavier than this are re-compressed with Sharp. */
export const OPTIMIZE_PNG_OVER_BYTES = 4 * 1024 * 1024;

export const DOWNLOAD_URL_TTL_SECONDS = 300;
export const ASSET_URL_TTL_SECONDS = 600;

export const DEFAULT_MAX_ACTIVE_PER_WORKSPACE = 3;
export const DEFAULT_MAX_PER_HOUR = 20;
export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_CONCURRENCY = 2;
export const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class RenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Transient errors are retried with backoff; permanent ones are not. */
    readonly transient = false,
  ) {
    super(message);
    this.name = 'RenderError';
  }
}
