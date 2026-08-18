export type ColorRef = { brandColorId: string } | { hex: string };
export type FontRef = { brandFontId: string } | { family: string };

export const FIELD_TYPES = [
  'text',
  'longtext',
  'image',
  'date',
  'select',
  'color',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  maxLength?: number;
  options?: string[];
  defaultValue?: string;
}

interface BaseLayer {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  bind?: { fieldKey: string };
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontRef: FontRef;
  fontSize: number;
  fontWeight?: number;
  color: ColorRef;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  assetId?: string;
  fit: 'cover' | 'contain';
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  fill: ColorRef;
  radius?: number;
}

export type Layer = TextLayer | ImageLayer | ShapeLayer;

export interface TemplateDocument {
  schemaVersion: 1;
  canvas: { width: number; height: number; unit: 'px'; background: ColorRef };
  fields: FieldDef[];
  layers: Layer[];
}

export interface DocumentContext {
  brandColorIds: Set<string>;
  brandFontIds: Set<string>;
  assetIds: Set<string>;
}

export const MIN_CANVAS = 100;
export const MAX_CANVAS = 4096;
export const MAX_FIELDS = 50;
export const MAX_LAYERS = 100;

export function createBlankDocument(): TemplateDocument {
  return {
    schemaVersion: 1,
    canvas: {
      width: 1080,
      height: 1080,
      unit: 'px',
      background: { hex: '#FFFFFF' },
    },
    fields: [],
    layers: [],
  };
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Returns every asset id referenced by image layers of a document-like value. */
export function collectAssetIds(doc: unknown): string[] {
  if (!isRec(doc) || !Array.isArray(doc.layers)) return [];
  const ids = new Set<string>();
  for (const layer of doc.layers) {
    if (isRec(layer) && layer.type === 'image' && isStr(layer.assetId)) {
      ids.add(layer.assetId);
    }
  }
  return [...ids];
}

function checkColor(
  value: unknown,
  path: string,
  ctx: DocumentContext,
  errors: string[],
): void {
  if (!isRec(value)) {
    errors.push(`${path}: color inválido`);
    return;
  }
  if (isStr(value.brandColorId)) {
    if (!ctx.brandColorIds.has(value.brandColorId)) {
      errors.push(`${path}: el color de marca no existe`);
    }
  } else if (!isStr(value.hex) || !/^#[0-9a-fA-F]{6}$/.test(value.hex)) {
    errors.push(`${path}: debe ser un color de marca o un hex #RRGGBB`);
  }
}

function checkFont(
  value: unknown,
  path: string,
  ctx: DocumentContext,
  errors: string[],
): void {
  if (!isRec(value)) {
    errors.push(`${path}: fuente inválida`);
    return;
  }
  if (isStr(value.brandFontId)) {
    if (!ctx.brandFontIds.has(value.brandFontId)) {
      errors.push(`${path}: la fuente de marca no existe`);
    }
  } else if (!isStr(value.family) || value.family.trim() === '') {
    errors.push(`${path}: debe ser una fuente de marca o una familia`);
  }
}

function checkFields(
  fields: unknown,
  errors: string[],
): Map<string, FieldType> {
  const keys = new Map<string, FieldType>();
  if (!Array.isArray(fields)) {
    errors.push('fields: debe ser una lista');
    return keys;
  }
  if (fields.length > MAX_FIELDS) {
    errors.push(`fields: máximo ${MAX_FIELDS} campos`);
  }
  fields.forEach((f: unknown, i) => {
    const p = `fields[${i}]`;
    if (!isRec(f)) {
      errors.push(`${p}: inválido`);
      return;
    }
    if (!isStr(f.key) || !/^[a-z][a-z0-9_]{0,49}$/.test(f.key)) {
      errors.push(`${p}.key: usa snake_case (ej. titulo_evento)`);
    } else if (keys.has(f.key)) {
      errors.push(`${p}.key: la clave "${f.key}" está duplicada`);
    }
    if (!isStr(f.label) || f.label.trim() === '' || f.label.length > 100) {
      errors.push(`${p}.label: requerido (máx. 100 caracteres)`);
    }
    if (
      !isStr(f.type) ||
      !(FIELD_TYPES as readonly string[]).includes(f.type)
    ) {
      errors.push(`${p}.type: tipo no soportado`);
    } else if (isStr(f.key)) {
      keys.set(f.key, f.type as FieldType);
    }
    if (typeof f.required !== 'boolean') {
      errors.push(`${p}.required: debe ser booleano`);
    }
    if (
      f.maxLength !== undefined &&
      (!Number.isInteger(f.maxLength) ||
        (f.maxLength as number) < 1 ||
        (f.maxLength as number) > 5000)
    ) {
      errors.push(`${p}.maxLength: entero entre 1 y 5000`);
    }
    if (f.type === 'select') {
      if (
        !Array.isArray(f.options) ||
        f.options.length === 0 ||
        !f.options.every(isStr)
      ) {
        errors.push(`${p}.options: un campo select necesita opciones`);
      }
    }
  });
  return keys;
}

/**
 * 'draft' tolerates work in progress (empty image layers, layers parked
 * outside the canvas); 'publish' enforces the full rules.
 */
export type ValidationMode = 'draft' | 'publish';

/**
 * Validates a TemplateDocument. Returns a list of human-readable errors
 * (empty list = valid). Pure function: all external state comes via `ctx`.
 */
export function validateTemplateDocument(
  doc: unknown,
  ctx: DocumentContext,
  mode: ValidationMode = 'publish',
): string[] {
  const errors: string[] = [];
  if (!isRec(doc)) return ['El documento debe ser un objeto'];
  if (doc.schemaVersion !== 1) errors.push('schemaVersion debe ser 1');

  let cw = 0;
  let ch = 0;
  if (!isRec(doc.canvas)) {
    errors.push('canvas: requerido');
  } else {
    const c = doc.canvas;
    for (const dim of ['width', 'height'] as const) {
      const v = c[dim];
      if (
        !Number.isInteger(v) ||
        (v as number) < MIN_CANVAS ||
        (v as number) > MAX_CANVAS
      ) {
        errors.push(
          `canvas.${dim}: entero entre ${MIN_CANVAS} y ${MAX_CANVAS}`,
        );
      }
    }
    cw = isNum(c.width) ? c.width : 0;
    ch = isNum(c.height) ? c.height : 0;
    if (c.unit !== 'px') errors.push('canvas.unit debe ser "px"');
    checkColor(c.background, 'canvas.background', ctx, errors);
  }

  const fieldTypes = checkFields(doc.fields, errors);

  if (!Array.isArray(doc.layers)) {
    errors.push('layers: debe ser una lista');
    return errors;
  }
  if (doc.layers.length > MAX_LAYERS) {
    errors.push(`layers: máximo ${MAX_LAYERS} capas`);
  }

  const ids = new Set<string>();
  doc.layers.forEach((l: unknown, i) => {
    const p = `layers[${i}]`;
    if (!isRec(l)) {
      errors.push(`${p}: inválida`);
      return;
    }
    if (!isStr(l.id) || l.id === '') errors.push(`${p}.id: requerido`);
    else if (ids.has(l.id)) errors.push(`${p}.id: duplicado`);
    else ids.add(l.id);
    if (!isStr(l.name)) errors.push(`${p}.name: requerido`);

    const geometryOk =
      isNum(l.x) && isNum(l.y) && isNum(l.width) && isNum(l.height);
    if (!geometryOk || (l.width as number) <= 0 || (l.height as number) <= 0) {
      errors.push(`${p}: x, y, width y height deben ser números (tamaño > 0)`);
    } else if (cw > 0 && ch > 0) {
      const x = l.x as number;
      const y = l.y as number;
      const w = l.width as number;
      const h = l.height as number;
      const ix = Math.max(0, Math.min(x + w, cw) - Math.max(x, 0));
      const iy = Math.max(0, Math.min(y + h, ch) - Math.max(y, 0));
      if (mode === 'publish' && ix * iy < 0.5 * w * h) {
        errors.push(`${p}: más de la mitad de la capa queda fuera del lienzo`);
      }
    }
    if (l.rotation !== undefined && !isNum(l.rotation)) {
      errors.push(`${p}.rotation: debe ser numérico`);
    }
    if (
      l.opacity !== undefined &&
      (!isNum(l.opacity) || l.opacity < 0 || l.opacity > 1)
    ) {
      errors.push(`${p}.opacity: entre 0 y 1`);
    }

    let boundType: FieldType | undefined;
    if (l.bind !== undefined) {
      if (!isRec(l.bind) || !isStr(l.bind.fieldKey)) {
        errors.push(`${p}.bind: inválido`);
      } else {
        boundType = fieldTypes.get(l.bind.fieldKey);
        if (!boundType) {
          errors.push(`${p}.bind: el campo "${l.bind.fieldKey}" no existe`);
        }
      }
    }

    switch (l.type) {
      case 'text':
        if (!isStr(l.text) || l.text.length > 5000) {
          errors.push(`${p}.text: texto requerido (máx. 5000)`);
        }
        checkFont(l.fontRef, `${p}.fontRef`, ctx, errors);
        checkColor(l.color, `${p}.color`, ctx, errors);
        if (!isNum(l.fontSize) || l.fontSize < 1 || l.fontSize > 1000) {
          errors.push(`${p}.fontSize: entre 1 y 1000`);
        }
        if (
          l.lineHeight !== undefined &&
          (!isNum(l.lineHeight) || l.lineHeight < 0.5 || l.lineHeight > 5)
        ) {
          errors.push(`${p}.lineHeight: entre 0.5 y 5`);
        }
        if (
          l.align !== undefined &&
          !['left', 'center', 'right'].includes(l.align as string)
        ) {
          errors.push(`${p}.align: left, center o right`);
        }
        if (boundType === 'image') {
          errors.push(
            `${p}.bind: una capa de texto no puede usar un campo de imagen`,
          );
        }
        break;
      case 'image':
        if (!['cover', 'contain'].includes(l.fit as string)) {
          errors.push(`${p}.fit: cover o contain`);
        }
        if (l.assetId !== undefined) {
          if (!isStr(l.assetId) || !ctx.assetIds.has(l.assetId)) {
            errors.push(`${p}.assetId: el asset no existe en este espacio`);
          }
        } else if (!l.bind && mode === 'publish') {
          errors.push(`${p}: una imagen necesita assetId o un campo vinculado`);
        }
        if (boundType && boundType !== 'image') {
          errors.push(`${p}.bind: debe vincularse a un campo de tipo imagen`);
        }
        break;
      case 'shape':
        if (!['rect', 'ellipse'].includes(l.shape as string)) {
          errors.push(`${p}.shape: rect o ellipse`);
        }
        checkColor(l.fill, `${p}.fill`, ctx, errors);
        if (l.radius !== undefined && (!isNum(l.radius) || l.radius < 0)) {
          errors.push(`${p}.radius: debe ser >= 0`);
        }
        break;
      default:
        errors.push(`${p}.type: text, image o shape`);
    }
  });

  return errors;
}
