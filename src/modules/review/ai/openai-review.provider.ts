import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  AiError,
  AiReviewInput,
  AiReviewProvider,
  AiReviewResult,
} from './ai-review.provider';
import { AI_JSON_SCHEMA } from './ai-output';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';

export const DEFAULT_AI_MODEL = 'gpt-4o';
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
const MAX_COMPLETION_TOKENS = 4000;

/** OpenAI vision + structured outputs implementation of the AI review. */
@Injectable()
export class OpenAiReviewProvider extends AiReviewProvider {
  private readonly logger = new Logger(OpenAiReviewProvider.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return !!this.config.get<string>('OPENAI_API_KEY');
  }

  private getClient(): OpenAI {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new AiError('NOT_CONFIGURED', 'La IA no está configurada');
    }
    this.client ??= new OpenAI({
      apiKey,
      timeout: this.config.get<number>('AI_TIMEOUT_MS', DEFAULT_AI_TIMEOUT_MS),
      maxRetries: 1,
    });
    return this.client;
  }

  async review(input: AiReviewInput): Promise<AiReviewResult> {
    const client = this.getClient();
    const model = this.config.get<string>('AI_MODEL', DEFAULT_AI_MODEL);

    try {
      const res = await client.chat.completions.create({
        model,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${input.imagePng.toString('base64')}`,
                  detail: 'high',
                },
              },
              { type: 'text', text: buildUserPrompt(input) },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'design_review',
            strict: true,
            schema: AI_JSON_SCHEMA,
          },
        },
      });

      const choice = res.choices[0];
      if (!choice) {
        throw new AiError('INVALID_RESPONSE', 'Respuesta vacía de la IA');
      }
      if (choice.message.refusal) {
        throw new AiError('REFUSED', 'La IA rechazó revisar esta pieza');
      }
      if (choice.finish_reason === 'length') {
        throw new AiError(
          'TRUNCATED',
          'La respuesta de la IA quedó incompleta',
        );
      }

      let output: unknown;
      try {
        output = JSON.parse(choice.message.content ?? '');
      } catch {
        throw new AiError('INVALID_RESPONSE', 'La IA no devolvió JSON válido');
      }

      return {
        output,
        model: res.model ?? model,
        tokensIn: res.usage?.prompt_tokens ?? 0,
        tokensOut: res.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      throw this.toAiError(err);
    }
  }

  private toAiError(err: unknown): AiError {
    if (err instanceof AiError) return err;
    // Never log prompts, images or user text: only the error class.
    this.logger.warn(`Fallo del proveedor de IA: ${String(err).slice(0, 200)}`);
    if (err instanceof OpenAI.APIConnectionTimeoutError) {
      return new AiError('TIMEOUT', 'La IA tardó demasiado en responder');
    }
    if (err instanceof OpenAI.RateLimitError) {
      return new AiError(
        'RATE_LIMITED',
        'La IA está saturada, reintenta luego',
      );
    }
    if (err instanceof OpenAI.AuthenticationError) {
      return new AiError('AUTH', 'La clave de la IA no es válida');
    }
    return new AiError('PROVIDER_ERROR', 'No se pudo consultar a la IA');
  }
}
