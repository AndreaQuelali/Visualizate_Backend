import type {
  ColorRef,
  FontRef,
  ImageLayer,
  Layer,
  ShapeLayer,
  TemplateDocument,
  TextLayer,
} from '../template/template-document';

export interface RenderBrand {
  colors: Array<{ id: string; hex: string }>;
  fonts: Array<{ id: string; family: string; assetId?: string }>;
}

export interface RenderContext {
  brand: RenderBrand;
  /** assetId -> short-lived URL the headless browser may fetch. */
  assetUrls: Record<string, string>;
  /** Origin allowed by the Content-Security-Policy (the object storage). */
  allowedOrigin: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a value placed inside a double-quoted CSS string. */
export function cssString(value: string): string {
  return value.replace(
    /[\\"\n\r\f<>]/g,
    (c) => `\\${c.charCodeAt(0).toString(16)} `,
  );
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function color(ref: ColorRef, ctx: RenderContext): string {
  if ('hex' in ref) return HEX.test(ref.hex) ? ref.hex : '#000000';
  const hex = ctx.brand.colors.find((c) => c.id === ref.brandColorId)?.hex;
  return hex && HEX.test(hex) ? hex : '#000000';
}

function fontFamily(ref: FontRef, ctx: RenderContext): string {
  const family =
    'family' in ref
      ? ref.family
      : ctx.brand.fonts.find((f) => f.id === ref.brandFontId)?.family;
  return family ? `"${cssString(family)}", sans-serif` : 'sans-serif';
}

function boxStyle(layer: Layer): string {
  const rotation = num(layer.rotation);
  return [
    'position:absolute',
    `left:${num(layer.x)}px`,
    `top:${num(layer.y)}px`,
    `width:${num(layer.width)}px`,
    `height:${num(layer.height)}px`,
    rotation ? `transform:rotate(${rotation}deg)` : '',
    `opacity:${Math.min(1, Math.max(0, num(layer.opacity, 1)))}`,
  ]
    .filter(Boolean)
    .join(';');
}

function textLayer(
  layer: TextLayer,
  data: Record<string, string>,
  ctx: RenderContext,
): string {
  const value = layer.bind ? (data[layer.bind.fieldKey] ?? '') : layer.text;
  const align = ['left', 'center', 'right'].includes(layer.align ?? '')
    ? layer.align
    : 'left';
  const style = [
    'width:100%;height:100%;overflow:hidden',
    `color:${color(layer.color, ctx)}`,
    `font-family:${fontFamily(layer.fontRef, ctx)}`,
    `font-size:${num(layer.fontSize, 16)}px`,
    `font-weight:${Math.round(num(layer.fontWeight, 400))}`,
    `line-height:${num(layer.lineHeight, 1.2)}`,
    `text-align:${align}`,
    'white-space:pre-wrap;overflow-wrap:anywhere',
  ].join(';');
  return `<div style="${boxStyle(layer)}"><div style="${style}">${escapeHtml(value)}</div></div>`;
}

function imageLayer(
  layer: ImageLayer,
  data: Record<string, string>,
  ctx: RenderContext,
): string {
  const assetId = layer.bind ? data[layer.bind.fieldKey] : layer.assetId;
  const url = assetId ? ctx.assetUrls[assetId] : undefined;
  const fit = layer.fit === 'contain' ? 'contain' : 'cover';
  const inner = url
    ? `<img src="${escapeHtml(url)}" alt="" style="width:100%;height:100%;object-fit:${fit};display:block">`
    : '';
  return `<div style="${boxStyle(layer)}">${inner}</div>`;
}

function shapeLayer(layer: ShapeLayer, ctx: RenderContext): string {
  const radius =
    layer.shape === 'ellipse' ? '50%' : `${Math.max(0, num(layer.radius))}px`;
  const style = `${boxStyle(layer)};background-color:${color(layer.fill, ctx)};border-radius:${radius}`;
  return `<div style="${style}"></div>`;
}

/**
 * Pure function: TemplateDocument + piece data -> a self-contained HTML page.
 * Mirrors the editor's TemplateCanvas so the exported file matches the preview.
 * All user text is escaped; the page carries a strict CSP (no scripts, only
 * images/fonts from the storage origin).
 */
export function documentToHtml(
  doc: TemplateDocument,
  data: Record<string, string>,
  ctx: RenderContext,
): string {
  const width = num(doc.canvas.width, 1080);
  const height = num(doc.canvas.height, 1080);
  const origin = escapeHtml(ctx.allowedOrigin);

  const fontFaces = ctx.brand.fonts
    .filter((f) => f.assetId && ctx.assetUrls[f.assetId])
    .map(
      (f) =>
        `@font-face{font-family:"${cssString(f.family)}";src:url("${cssString(
          ctx.assetUrls[f.assetId as string],
        )}");font-weight:100 900;font-display:block}`,
    )
    .join('');

  const layers = doc.layers
    .map((layer) => {
      switch (layer.type) {
        case 'text':
          return textLayer(layer, data, ctx);
        case 'image':
          return imageLayer(layer, data, ctx);
        case 'shape':
          return shapeLayer(layer, ctx);
        default:
          return '';
      }
    })
    .join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${origin} data:; font-src ${origin}; style-src 'unsafe-inline'">
<style>
${fontFaces}
@page{size:${width}px ${height}px;margin:0}
html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}
#c{position:relative;width:${width}px;height:${height}px;overflow:hidden;background-color:${color(doc.canvas.background, ctx)}}
</style></head>
<body><div id="c">${layers}</div></body></html>`;
}
