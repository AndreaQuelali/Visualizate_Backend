export const REVIEW_QUEUE = 'review';

export const DEFAULT_REVIEW_CONCURRENCY = 2;
export const DEFAULT_MAX_PER_PIECE_HOUR = 10;
export const DEFAULT_MONTHLY_QUOTA = 100;

/** The image sent to the AI is downscaled so cost and latency stay bounded. */
export const AI_IMAGE_MAX_SIDE = 1568;

export const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
