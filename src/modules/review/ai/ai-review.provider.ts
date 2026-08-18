/**
 * Provider-agnostic contract for the AI part of a review. The concrete
 * provider (OpenAI today) is injected through AI_REVIEW_PROVIDER so it can be
 * swapped without touching the review flow.
 */
export const AI_REVIEW_PROVIDER = 'AI_REVIEW_PROVIDER';

export type AiErrorCode =
  | 'NOT_CONFIGURED'
  | 'REFUSED'
  | 'TRUNCATED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'AUTH'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiLayerSummary {
  id: string;
  name: string;
  type: 'text' | 'image' | 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  /** Resolved #RRGGBB of the text color (text) or fill (shape). */
  color?: string;
  boundField?: string;
}

export interface AiReviewInput {
  imagePng: Buffer;
  canvas: { width: number; height: number };
  layers: AiLayerSummary[];
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
  }>;
  /** Untrusted user content. Must only ever be sent as delimited data. */
  data: Record<string, string>;
  brandColors: Array<{ name: string; hex: string }>;
  ruleFindings: Array<{ category: string; title: string }>;
}

export interface AiReviewResult {
  /** Raw model JSON (validated later by normalizeAiOutput). */
  output: unknown;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export abstract class AiReviewProvider {
  abstract isConfigured(): boolean;
  abstract review(input: AiReviewInput): Promise<AiReviewResult>;
}
