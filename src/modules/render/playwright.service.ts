import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright';
import { RENDER_TIMEOUT_MS, RenderError } from './render.constants';

export interface CaptureOptions {
  html: string;
  width: number;
  height: number;
  format: 'PNG' | 'PDF';
  scale: number;
  /** Only requests to these origins (plus data:) are allowed. */
  allowedOrigins: string[];
  timeoutMs?: number;
}

/**
 * Wraps a shared headless Chromium. One browser per process, one isolated
 * context per job (JS disabled, network restricted to the storage origin).
 */
@Injectable()
export class PlaywrightService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.launching ??= chromium
      .launch({ headless: true })
      .then((b) => {
        this.browser = b;
        b.on('disconnected', () => {
          this.browser = null;
        });
        return b;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        throw new RenderError(
          'BROWSER_UNAVAILABLE',
          `No se pudo iniciar el navegador de render: ${message}`,
          true,
        );
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  async capture(opts: CaptureOptions): Promise<Buffer> {
    const timeout = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.format === 'PNG' ? opts.scale : 1,
      javaScriptEnabled: false,
      acceptDownloads: false,
    });

    const failures: string[] = [];
    try {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        const allowed =
          url.startsWith('data:') ||
          url.startsWith('about:') ||
          opts.allowedOrigins.some((o) => url.startsWith(`${o}/`));
        if (allowed) return route.continue();
        failures.push(`blocked:${new URL(url).origin}`);
        return route.abort('blockedbyclient');
      });

      const page = await context.newPage();
      page.on('response', (res) => {
        if (res.status() >= 400) failures.push(`http${res.status()}`);
      });
      page.on('requestfailed', (req) => {
        if (!req.failure()?.errorText.includes('BLOCKED')) {
          failures.push(`failed:${req.failure()?.errorText ?? 'unknown'}`);
        }
      });

      try {
        await page.setContent(opts.html, { waitUntil: 'networkidle', timeout });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new RenderError(
          'RENDER_TIMEOUT',
          `El render superó el tiempo máximo: ${message}`,
          true,
        );
      }

      if (failures.length > 0) {
        throw new RenderError(
          'ASSET_LOAD_FAILED',
          'No se pudo cargar una imagen o fuente de la pieza',
        );
      }

      if (opts.format === 'PNG') {
        return await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width: opts.width, height: opts.height },
          timeout,
        });
      }
      return await page.pdf({
        width: `${opts.width}px`,
        height: `${opts.height}px`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        pageRanges: '1',
      });
    } finally {
      await context.close().catch((err: unknown) => {
        this.logger.warn(`No se pudo cerrar el contexto: ${String(err)}`);
      });
    }
  }

  async onModuleDestroy() {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
