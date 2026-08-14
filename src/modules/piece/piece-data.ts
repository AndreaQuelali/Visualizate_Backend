import { FieldDef } from '../template/template-document';

export interface FieldError {
  field: string;
  message: string;
}

export type PieceData = Record<string, string>;

const DEFAULT_MAX_TEXT = 200;
const DEFAULT_MAX_LONGTEXT = 2000;

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '';

/** Initial data for a new piece: every field with its default (or empty). */
export function initialData(fields: FieldDef[]): PieceData {
  const data: PieceData = {};
  for (const f of fields) data[f.key] = f.defaultValue ?? '';
  return data;
}

/** Asset ids referenced by image fields of a piece. */
export function imageAssetIds(
  fields: FieldDef[],
  data: Record<string, unknown>,
): string[] {
  const ids = new Set<string>();
  for (const f of fields) {
    const v = data[f.key];
    if (f.type === 'image' && typeof v === 'string' && v !== '') ids.add(v);
  }
  return [...ids];
}

/**
 * Validates piece data against the template fields.
 * - Types, maxLength and options are always checked.
 * - "required" is only enforced when `requireAll` (to mark a piece READY).
 * Returns one error per offending field (empty list = valid).
 */
export function validatePieceData(
  fields: FieldDef[],
  data: Record<string, unknown>,
  opts: { requireAll: boolean; validImageAssetIds: Set<string> },
): FieldError[] {
  const errors: FieldError[] = [];
  const known = new Set(fields.map((f) => f.key));

  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      errors.push({
        field: key,
        message: 'Campo desconocido para esta plantilla',
      });
    }
  }

  for (const f of fields) {
    const value = data[f.key];

    if (isEmpty(value)) {
      if (opts.requireAll && f.required) {
        errors.push({ field: f.key, message: `${f.label} es obligatorio` });
      }
      continue;
    }
    if (typeof value !== 'string') {
      errors.push({ field: f.key, message: `${f.label} debe ser texto` });
      continue;
    }

    switch (f.type) {
      case 'text':
      case 'longtext': {
        const max =
          f.maxLength ??
          (f.type === 'text' ? DEFAULT_MAX_TEXT : DEFAULT_MAX_LONGTEXT);
        if (value.length > max) {
          errors.push({
            field: f.key,
            message: `${f.label} no puede superar ${max} caracteres`,
          });
        }
        break;
      }
      case 'date': {
        const valid =
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
          new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
        if (!valid) {
          errors.push({
            field: f.key,
            message: `${f.label} debe ser una fecha válida (AAAA-MM-DD)`,
          });
        }
        break;
      }
      case 'select':
        if (!f.options?.includes(value)) {
          errors.push({
            field: f.key,
            message: `${f.label}: elige una de las opciones disponibles`,
          });
        }
        break;
      case 'color':
        if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
          errors.push({
            field: f.key,
            message: `${f.label} debe ser un color #RRGGBB`,
          });
        }
        break;
      case 'image':
        if (!opts.validImageAssetIds.has(value)) {
          errors.push({
            field: f.key,
            message: `${f.label}: la imagen no existe en este espacio`,
          });
        }
        break;
    }
  }
  return errors;
}

/**
 * Carries a piece's data over to another version of the template.
 * Keeps values whose key and type still match, fills new fields with their
 * defaults and reports the keys that could not be kept.
 */
export function reconcileData(
  oldFields: FieldDef[],
  newFields: FieldDef[],
  data: Record<string, unknown>,
): { data: PieceData; dropped: string[] } {
  const oldTypes = new Map(oldFields.map((f) => [f.key, f.type]));
  const result: PieceData = {};
  for (const f of newFields) {
    const v = data[f.key];
    const sameType = oldTypes.get(f.key) === f.type;
    result[f.key] =
      sameType && typeof v === 'string' ? v : (f.defaultValue ?? '');
  }
  const newKeys = new Set(newFields.map((f) => f.key));
  const dropped = Object.keys(data).filter(
    (k) => !newKeys.has(k) && !isEmpty(data[k]),
  );
  for (const f of newFields) {
    if (
      oldTypes.has(f.key) &&
      oldTypes.get(f.key) !== f.type &&
      !isEmpty(data[f.key])
    ) {
      dropped.push(f.key);
    }
  }
  return { data: result, dropped };
}
