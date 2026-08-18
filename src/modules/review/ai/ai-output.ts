import type {
  FieldDef,
  TemplateDocument,
} from '../../template/template-document';
import { validatePieceData } from '../../piece/piece-data';
import {
  effectiveValue,
  OVERRIDE_PROPS,
  propAllowedFor,
  type OverrideProp,
} from '../../piece/piece-overrides';
import type {
  BrandInfo,
  Category,
  Patch,
  ReviewFinding,
  Severity,
} from '../review.types';

const CATEGORIES: Category[] = [
  'LEGIBILITY',
  'COMPOSITION',
  'CONTENT',
  'BRAND',
];
const SEVERITIES: Severity[] = ['INFO', 'WARNING', 'CRITICAL'];
const PATCHABLE_FIELD_TYPES = ['text', 'longtext', 'select', 'date', 'color'];

export const MAX_AI_ITEMS = 10;
const MAX_TITLE = 120;
const MAX_EXPLANATION = 500;

/** Strict JSON schema for the model output (structured outputs). */
export const AI_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category',
          'severity',
          'title',
          'explanation',
          'target_layer_id',
          'target_field_key',
          'patch_kind',
          'patch_field_key',
          'patch_layer_id',
          'patch_prop',
          'patch_text',
          'patch_number',
        ],
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          severity: { type: 'string', enum: SEVERITIES },
          title: { type: 'string' },
          explanation: { type: 'string' },
          target_layer_id: { type: 'string' },
          target_field_key: { type: 'string' },
          patch_kind: {
            type: 'string',
            enum: ['none', 'piece_data', 'layer_prop'],
          },
          patch_field_key: { type: 'string' },
          patch_layer_id: { type: 'string' },
          patch_prop: { type: 'string', enum: ['none', ...OVERRIDE_PROPS] },
          patch_text: { type: 'string' },
          patch_number: { type: 'number' },
        },
      },
    },
  },
} as const;

export interface NormalizeContext {
  doc: TemplateDocument;
  overrides: unknown;
  data: Record<string, string>;
  brand: BrandInfo;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function buildPatch(
  item: Record<string, unknown>,
  ctx: NormalizeContext,
): Patch | null {
  const kind = str(item.patch_kind);

  if (kind === 'piece_data') {
    const key = str(item.patch_field_key);
    const field: FieldDef | undefined = ctx.doc.fields.find(
      (f) => f.key === key,
    );
    if (!field || !PATCHABLE_FIELD_TYPES.includes(field.type)) return null;
    const to = typeof item.patch_text === 'string' ? item.patch_text : '';
    const from = ctx.data[key] ?? '';
    if (to === from) return null;
    // The proposed value must satisfy the field's own rules.
    const errors = validatePieceData(
      [field],
      { [key]: to },
      { requireAll: false, validImageAssetIds: new Set() },
    );
    if (errors.length > 0) return null;
    return { kind: 'piece_data', fieldKey: key, from, to };
  }

  if (kind === 'layer_prop') {
    const layerId = str(item.patch_layer_id);
    const prop = str(item.patch_prop) as OverrideProp;
    const layer = ctx.doc.layers.find((l) => l.id === layerId);
    if (!layer || !OVERRIDE_PROPS.includes(prop)) return null;
    if (!propAllowedFor(layer.type, prop)) return null;

    const { width: cw, height: ch } = ctx.doc.canvas;
    const n = item.patch_number;
    let to: unknown;
    if (prop === 'color') {
      const hex = str(item.patch_text);
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
      const brand = ctx.brand.colors.find(
        (c) => c.hex.toLowerCase() === hex.toLowerCase(),
      );
      to = brand ? { brandColorId: brand.id } : { hex };
    } else {
      if (typeof n !== 'number' || !Number.isFinite(n)) return null;
      const v = Math.round(n);
      const ok =
        (prop === 'fontSize' && v >= 8 && v <= 400) ||
        (prop === 'x' && v >= 0 && v <= cw - 10) ||
        (prop === 'y' && v >= 0 && v <= ch - 10) ||
        (prop === 'width' && v >= 10 && v <= cw) ||
        (prop === 'height' && v >= 10 && v <= ch);
      if (!ok) return null;
      to = v;
    }
    const from = effectiveValue(ctx.doc, ctx.overrides, layerId, prop);
    if (JSON.stringify(from) === JSON.stringify(to)) return null;
    return { kind: 'layer_prop', layerId, prop, from, to };
  }

  return null;
}

/**
 * Validates the model output against the real document. Anything that does
 * not check out (unknown layer, out-of-range value, wrong type) is dropped or
 * downgraded to advice without a patch, so a bad answer can never produce an
 * unsafe change.
 */
export function normalizeAiOutput(
  raw: unknown,
  ctx: NormalizeContext,
): { summary: string; findings: ReviewFinding[] } {
  if (!isRec(raw) || !Array.isArray(raw.items)) {
    return { summary: '', findings: [] };
  }
  const summary = str(raw.summary).slice(0, 600);
  const findings: ReviewFinding[] = [];

  for (const item of raw.items) {
    if (findings.length >= MAX_AI_ITEMS) break;
    if (!isRec(item)) continue;

    const category = str(item.category) as Category;
    const severity = str(item.severity) as Severity;
    const title = str(item.title).slice(0, MAX_TITLE);
    const explanation = str(item.explanation).slice(0, MAX_EXPLANATION);
    if (!CATEGORIES.includes(category) || !SEVERITIES.includes(severity)) {
      continue;
    }
    if (title === '' || explanation === '') continue;

    const layerId = str(item.target_layer_id);
    const fieldKey = str(item.target_field_key);
    const target: ReviewFinding['target'] = {};
    if (ctx.doc.layers.some((l) => l.id === layerId)) target.layerId = layerId;
    if (ctx.doc.fields.some((f) => f.key === fieldKey)) {
      target.fieldKey = fieldKey;
    }

    findings.push({
      category,
      severity,
      source: 'AI',
      title,
      explanation,
      target: Object.keys(target).length > 0 ? target : null,
      patch: buildPatch(item, ctx),
    });
  }
  return { summary, findings };
}
