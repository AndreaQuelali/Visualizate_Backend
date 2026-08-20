import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const MESSAGE = 'Demasiadas solicitudes. Inténtalo de nuevo en un momento';

/** Global guard: limits every client by IP address (named throttler `ip`). */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected errorMessage = MESSAGE;

  async onModuleInit() {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name === 'ip');
  }
}

/**
 * Per-user limit (named throttler `user`). It must run after `JwtAuthGuard`
 * so `req.user` is available; anonymous requests fall back to their IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected errorMessage = MESSAGE;

  async onModuleInit() {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name === 'user');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    const ip = req.ip as string | undefined;
    return Promise.resolve(user?.id ?? ip ?? 'unknown');
  }
}
