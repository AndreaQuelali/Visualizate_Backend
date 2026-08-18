import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { RenderLimitException } from './render.service';

/** Turns a RenderLimitException into a 429 with a Retry-After header. */
@Catch(RenderLimitException)
export class RenderLimitFilter implements ExceptionFilter {
  catch(exception: RenderLimitException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res
      .status(429)
      .setHeader('Retry-After', String(exception.retryAfterSeconds))
      .json({
        statusCode: 429,
        message: exception.message,
        retryAfterSeconds: exception.retryAfterSeconds,
      });
  }
}
