import type { Layer, TemplateDocument } from '../template/template-document';

/**
 * Per-piece tweaks applied on top of the template document (used by review
 * recommendations). They never touch the template itself, so other pieces
 * made from it are unaffected.
 */
export const OVERRIDE_PROPS = [
  'fontSize',
  'x',
  'y',
  'width',
  'height',
  'color',
] as const;
export type OverrideProp = (typeof OVERRIDE_PROPS)[number];

export type PieceOverrides = Record<
  string,
  Partial<Record<OverrideProp, unknown>>
>;

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Which layer types may carry each overridable property. */
export function propAllowedFor(
  layerType: Layer['type'],
  prop: OverrideProp,
): boolean {
  if (prop === 'fontSize' || prop === 'color') return layerType === 'text';
  return true;
}

/** Drops anything that is not a known property of the right shape. */
export function sanitizeOverrides(value: unknown): PieceOverrides {
  const out: PieceOverrides = {};
  if (!isRec(value)) return out;
  for (const [layerId, props] of Object.entries(value)) {
    if (!isRec(props)) continue;
    const clean: Partial<Record<OverrideProp, unknown>> = {};
    for (const prop of OVERRIDE_PROPS) {
      if (prop in props) clean[prop] = props[prop];
    }
    if (Object.keys(clean).length > 0) out[layerId] = clean;
  }
  return out;
}

/** Returns a copy of the document with the overrides merged into its layers. */
export function applyOverrides(
  doc: TemplateDocument,
  overrides: unknown,
): TemplateDocument {
  const clean = sanitizeOverrides(overrides);
  if (Object.keys(clean).length === 0) return doc;
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      const o = clean[layer.id];
      if (!o) return layer;
      const merged: Record<string, unknown> = { ...layer };
      for (const prop of OVERRIDE_PROPS) {
        if (prop in o && propAllowedFor(layer.type, prop)) {
          merged[prop] = o[prop];
        }
      }
      return merged as unknown as Layer;
    }),
  };
}

/** Current value of a layer property: the override if any, else the template's. */
export function effectiveValue(
  doc: TemplateDocument,
  overrides: unknown,
  layerId: string,
  prop: OverrideProp,
): unknown {
  const o = sanitizeOverrides(overrides)[layerId];
  if (o && prop in o) return o[prop];
  const layer = doc.layers.find((l) => l.id === layerId);
  return layer
    ? (layer as unknown as Record<string, unknown>)[prop]
    : undefined;
}
