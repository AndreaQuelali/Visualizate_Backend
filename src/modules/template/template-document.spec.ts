import {
  createBlankDocument,
  DocumentContext,
  TemplateDocument,
  validateTemplateDocument,
} from './template-document';

const ctx: DocumentContext = {
  brandColorIds: new Set(['c1']),
  brandFontIds: new Set(['f1']),
  assetIds: new Set(['a1']),
};

function valid(): TemplateDocument {
  return {
    schemaVersion: 1,
    canvas: {
      width: 1080,
      height: 1080,
      unit: 'px',
      background: { brandColorId: 'c1' },
    },
    fields: [
      { key: 'titulo', label: 'Título', type: 'text', required: true },
      { key: 'foto', label: 'Foto', type: 'image', required: false },
    ],
    layers: [
      {
        id: 'l1',
        type: 'text',
        name: 'Título',
        x: 40,
        y: 40,
        width: 500,
        height: 120,
        text: 'Hola',
        fontRef: { brandFontId: 'f1' },
        fontSize: 64,
        color: { hex: '#111111' },
        bind: { fieldKey: 'titulo' },
      },
      {
        id: 'l2',
        type: 'image',
        name: 'Foto',
        x: 0,
        y: 200,
        width: 1080,
        height: 600,
        fit: 'cover',
        bind: { fieldKey: 'foto' },
      },
    ],
  };
}

describe('validateTemplateDocument', () => {
  it('accepts a valid document and the blank document', () => {
    expect(validateTemplateDocument(valid(), ctx)).toEqual([]);
    expect(validateTemplateDocument(createBlankDocument(), ctx)).toEqual([]);
  });

  it('rejects a bind to a non-existent field', () => {
    const doc = valid();
    doc.layers[0].bind = { fieldKey: 'no_existe' };
    expect(validateTemplateDocument(doc, ctx).join('|')).toContain('no_existe');
  });

  it('rejects duplicate field keys and invalid keys', () => {
    const doc = valid();
    doc.fields.push({
      key: 'titulo',
      label: 'Otro',
      type: 'text',
      required: false,
    });
    doc.fields.push({
      key: 'Mal Key',
      label: 'X',
      type: 'text',
      required: false,
    });
    const errors = validateTemplateDocument(doc, ctx).join('|');
    expect(errors).toContain('duplicada');
    expect(errors).toContain('snake_case');
  });

  it('rejects unknown brand color / font / asset references', () => {
    const doc = valid();
    doc.canvas.background = { brandColorId: 'x' };
    (doc.layers[0] as { fontRef: unknown }).fontRef = { brandFontId: 'x' };
    doc.layers.push({
      id: 'l3',
      type: 'image',
      name: 'Logo',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fit: 'contain',
      assetId: 'missing',
    });
    const errors = validateTemplateDocument(doc, ctx);
    expect(errors.some((e) => e.includes('color de marca'))).toBe(true);
    expect(errors.some((e) => e.includes('fuente de marca'))).toBe(true);
    expect(errors.some((e) => e.includes('asset no existe'))).toBe(true);
  });

  it('rejects layers mostly outside the canvas', () => {
    const doc = valid();
    doc.layers[0].x = 1000;
    doc.layers[0].width = 500; // only 80/500 visible
    expect(validateTemplateDocument(doc, ctx).join('|')).toContain(
      'fuera del lienzo',
    );
  });

  it('tolerates work in progress in drafts but not when publishing', () => {
    const doc = valid();
    // An image layer with no asset and no bound field, and a layer parked
    // outside the canvas.
    doc.layers[1] = {
      id: 'l2',
      type: 'image',
      name: 'Foto',
      x: 0,
      y: 200,
      width: 400,
      height: 300,
      fit: 'cover',
    };
    doc.layers[0].x = 5000;

    expect(validateTemplateDocument(doc, ctx, 'draft')).toEqual([]);
    const errors = validateTemplateDocument(doc, ctx, 'publish').join('|');
    expect(errors).toContain('una imagen necesita');
    expect(errors).toContain('fuera del lienzo');
  });

  it('keeps rejecting broken references even in drafts', () => {
    const doc = valid();
    doc.layers[0].bind = { fieldKey: 'no_existe' };
    doc.canvas.background = { brandColorId: 'x' };
    const errors = validateTemplateDocument(doc, ctx, 'draft');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects out-of-range canvas size and non-objects', () => {
    const doc = valid();
    doc.canvas.width = 50;
    expect(validateTemplateDocument(doc, ctx).join('|')).toContain(
      'canvas.width',
    );
    expect(validateTemplateDocument('x', ctx)).toHaveLength(1);
  });

  it('rejects a text layer bound to an image field', () => {
    const doc = valid();
    doc.layers[0].bind = { fieldKey: 'foto' };
    expect(validateTemplateDocument(doc, ctx).join('|')).toContain(
      'campo de imagen',
    );
  });
});
