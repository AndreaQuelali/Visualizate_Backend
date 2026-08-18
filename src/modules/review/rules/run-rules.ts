import type {
  ColorRef,
  ImageLayer,
  Layer,
  TemplateDocument,
  TextLayer,
} from '../../template/template-document';
import type { BrandInfo, ReviewFinding } from '../review.types';
import {
  colorDistance,
  contrastRatio,
  hexToRgb,
  requiredContrast,
} from './contrast';

export interface RuleInput {
  /** Document with the piece overrides already applied. */
  doc: TemplateDocument;
  data: Record<string, string>;
  brand: BrandInfo;
}

const MAX_FINDINGS = 40;

function resolveHex(ref: ColorRef, brand: BrandInfo): string | null {
  if ('hex' in ref) return hexToRgb(ref.hex) ? ref.hex : null;
  return brand.colors.find((c) => c.id === ref.brandColorId)?.hex ?? null;
}

export function textOf(layer: TextLayer, data: Record<string, string>): string {
  return layer.bind ? (data[layer.bind.fieldKey] ?? '') : layer.text;
}

export function minFontSize(doc: TemplateDocument): number {
  return Math.max(
    12,
    Math.round(Math.min(doc.canvas.width, doc.canvas.height) * 0.02),
  );
}

const contains = (l: Layer, x: number, y: number) =>
  x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height;

/**
 * What is painted behind a text layer's center: a brand/custom color, or
 * `null` when a photo is behind it (rules cannot judge contrast there).
 */
function backgroundBehind(
  doc: TemplateDocument,
  index: number,
  brand: BrandInfo,
): string | null {
  const layer = doc.layers[index];
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  for (let i = index - 1; i >= 0; i--) {
    const below = doc.layers[i];
    if (!contains(below, cx, cy)) continue;
    if (below.type === 'image') return null;
    if (below.type === 'shape') {
      const hex = resolveHex(below.fill, brand);
      if (hex) return hex;
    }
  }
  return resolveHex(doc.canvas.background, brand) ?? '#FFFFFF';
}

function isFullBleed(l: Layer, doc: TemplateDocument): boolean {
  return (
    l.width >= doc.canvas.width * 0.9 && l.height >= doc.canvas.height * 0.9
  );
}

function coversCanvas(l: Layer, doc: TemplateDocument): boolean {
  return (
    l.x <= 0 &&
    l.y <= 0 &&
    l.x + l.width >= doc.canvas.width &&
    l.y + l.height >= doc.canvas.height
  );
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

function moveInside(
  l: Layer,
  doc: TemplateDocument,
  margin: number,
): { prop: 'x' | 'y'; from: number; to: number } | null {
  const maxX = doc.canvas.width - margin - l.width;
  const maxY = doc.canvas.height - margin - l.height;
  if (l.x < margin || l.x > maxX) {
    if (maxX >= margin) {
      return { prop: 'x', from: l.x, to: Math.round(clamp(l.x, margin, maxX)) };
    }
  }
  if (l.y < margin || l.y > maxY) {
    if (maxY >= margin) {
      return { prop: 'y', from: l.y, to: Math.round(clamp(l.y, margin, maxY)) };
    }
  }
  return null;
}

function nearestBrandColor(hex: string, brand: BrandInfo) {
  let best: BrandInfo['colors'][number] | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of brand.colors) {
    const d = colorDistance(hex, c.hex);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function overlapArea(a: Layer, b: Layer): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Deterministic checks: fast, free and reproducible. They run before (and
 * independently of) the AI and give it context.
 */
export function runRules({ doc, data, brand }: RuleInput): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const { width: cw, height: ch } = doc.canvas;
  const minSize = minFontSize(doc);
  const margin = Math.round(Math.min(cw, ch) * 0.03);
  const brandHexes = new Set(brand.colors.map((c) => c.hex.toLowerCase()));

  doc.layers.forEach((layer, index) => {
    const target = { layerId: layer.id };

    // ── Composition: outside the canvas / too close to the edge ──────────
    const outside =
      layer.x < -1 ||
      layer.y < -1 ||
      layer.x + layer.width > cw + 1 ||
      layer.y + layer.height > ch + 1;
    if (outside && !(layer.type !== 'text' && coversCanvas(layer, doc))) {
      const move = moveInside(layer, doc, 0);
      out.push({
        category: 'COMPOSITION',
        severity: 'WARNING',
        source: 'RULE',
        title: `«${layer.name}» se sale del lienzo`,
        explanation:
          'Parte de la capa queda fuera del área visible y se cortará al exportar.',
        target,
        patch: move
          ? {
              kind: 'layer_prop',
              layerId: layer.id,
              prop: move.prop,
              from: move.from,
              to: move.to,
            }
          : null,
      });
    } else if (
      !outside &&
      layer.type !== 'shape' &&
      !isFullBleed(layer, doc) &&
      (layer.x < margin ||
        layer.y < margin ||
        layer.x + layer.width > cw - margin ||
        layer.y + layer.height > ch - margin)
    ) {
      const move = moveInside(layer, doc, margin);
      out.push({
        category: 'COMPOSITION',
        severity: 'INFO',
        source: 'RULE',
        title: `«${layer.name}» está muy pegada al borde`,
        explanation: `Deja al menos ${margin} px de margen de seguridad para que no se corte en impresión o recortes de redes.`,
        target,
        patch: move
          ? {
              kind: 'layer_prop',
              layerId: layer.id,
              prop: move.prop,
              from: move.from,
              to: move.to,
            }
          : null,
      });
    }

    // ── Brand: custom colors outside the palette ─────────────────────────
    if (brand.colors.length > 0) {
      const ref: ColorRef | null =
        layer.type === 'text'
          ? layer.color
          : layer.type === 'shape'
            ? layer.fill
            : null;
      if (ref && 'hex' in ref && !brandHexes.has(ref.hex.toLowerCase())) {
        const near = nearestBrandColor(ref.hex, brand);
        out.push({
          category: 'BRAND',
          severity: 'INFO',
          source: 'RULE',
          title: `Color fuera de marca en «${layer.name}»`,
          explanation: `Usa ${near ? `«${near.name}» (${near.hex})` : 'un color de la paleta'} para mantener la identidad visual consistente.`,
          target,
          patch:
            near && layer.type === 'text'
              ? {
                  kind: 'layer_prop',
                  layerId: layer.id,
                  prop: 'color',
                  from: ref,
                  to: { brandColorId: near.id },
                }
              : null,
        });
      }
    }

    if (layer.type !== 'text') return;
    const text = textOf(layer, data);
    if (text.trim() === '') return;

    // ── Legibility: contrast ─────────────────────────────────────────────
    const fg = resolveHex(layer.color, brand);
    const bg = backgroundBehind(doc, index, brand);
    if (fg && bg) {
      const weight = layer.fontWeight ?? 400;
      const need = requiredContrast(layer.fontSize, weight);
      const ratio = contrastRatio(fg, bg);
      if (ratio < need) {
        const passing = brand.colors
          .filter((c) => contrastRatio(c.hex, bg) >= need)
          .sort((a, b) => colorDistance(fg, a.hex) - colorDistance(fg, b.hex));
        let to: ColorRef | null = passing[0]
          ? { brandColorId: passing[0].id }
          : null;
        if (!to) {
          const fallback =
            contrastRatio('#000000', bg) >= contrastRatio('#FFFFFF', bg)
              ? '#000000'
              : '#FFFFFF';
          if (contrastRatio(fallback, bg) >= need) to = { hex: fallback };
        }
        out.push({
          category: 'LEGIBILITY',
          severity: ratio < 3 ? 'CRITICAL' : 'WARNING',
          source: 'RULE',
          title: `Poco contraste en «${layer.name}»`,
          explanation: `El contraste entre el texto y el fondo es ${ratio.toFixed(1)}:1 y se recomienda al menos ${need}:1 (WCAG AA).`,
          target,
          patch: to
            ? {
                kind: 'layer_prop',
                layerId: layer.id,
                prop: 'color',
                from: layer.color,
                to,
              }
            : null,
        });
      }
    }

    // ── Legibility: minimum font size ────────────────────────────────────
    if (layer.fontSize < minSize) {
      out.push({
        category: 'LEGIBILITY',
        severity: layer.fontSize < minSize * 0.6 ? 'CRITICAL' : 'WARNING',
        source: 'RULE',
        title: `Texto demasiado pequeño en «${layer.name}»`,
        explanation: `Con ${layer.fontSize}px puede ser ilegible en pantallas pequeñas. Para este formato se recomienda al menos ${minSize}px.`,
        target,
        patch: {
          kind: 'layer_prop',
          layerId: layer.id,
          prop: 'fontSize',
          from: layer.fontSize,
          to: minSize,
        },
      });
    }

    // ── Legibility: probable overflow (estimate) ─────────────────────────
    const avgChar =
      layer.fontSize * ((layer.fontWeight ?? 400) >= 700 ? 0.6 : 0.52);
    const perLine = Math.max(1, Math.floor(layer.width / avgChar));
    const lines = text
      .split('\n')
      .reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
    const needed = lines * layer.fontSize * (layer.lineHeight ?? 1.2);
    if (needed > layer.height * 1.05) {
      const fitted = Math.floor(
        layer.fontSize * Math.sqrt(layer.height / needed),
      );
      out.push({
        category: 'LEGIBILITY',
        severity: 'WARNING',
        source: 'RULE',
        title: `El texto de «${layer.name}» podría no caber`,
        explanation:
          'Es probable que el texto supere el alto de su recuadro y se corte al exportar. Acórtalo o reduce el tamaño.',
        target,
        patch:
          fitted >= minSize && fitted < layer.fontSize
            ? {
                kind: 'layer_prop',
                layerId: layer.id,
                prop: 'fontSize',
                from: layer.fontSize,
                to: fitted,
              }
            : null,
      });
    }
  });

  // ── Composition: overlapping text layers ───────────────────────────────
  const texts = doc.layers.filter(
    (l): l is TextLayer => l.type === 'text' && textOf(l, data).trim() !== '',
  );
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && overlapArea(a, b) > smaller * 0.25) {
        out.push({
          category: 'COMPOSITION',
          severity: 'WARNING',
          source: 'RULE',
          title: `«${a.name}» y «${b.name}» se solapan`,
          explanation:
            'Los dos textos ocupan la misma zona y pueden taparse entre sí. Sepáralos o reduce su tamaño.',
          target: { layerId: a.id },
          patch: null,
        });
      }
    }
  }

  // ── Content: required fields left empty ────────────────────────────────
  for (const f of doc.fields) {
    if (f.required && (data[f.key] ?? '').trim() === '') {
      out.push({
        category: 'CONTENT',
        severity: 'WARNING',
        source: 'RULE',
        title: `Falta completar «${f.label}»`,
        explanation: 'Es un campo obligatorio y la pieza saldría incompleta.',
        target: { fieldKey: f.key },
        patch: null,
      });
    }
  }

  return out.slice(0, MAX_FINDINGS);
}

export type { ImageLayer };
