import {
  createBlankDocument,
  TemplateDocument,
} from '../../template/template-document';
import type { BrandInfo } from '../review.types';
import { contrastRatio, requiredContrast } from './contrast';
import { minFontSize, runRules } from './run-rules';

const brand: BrandInfo = {
  colors: [
    { id: 'c-ink', name: 'Tinta', hex: '#111827' },
    { id: 'c-indigo', name: 'Indigo', hex: '#4648d4' },
    { id: 'c-white', name: 'Blanco', hex: '#FFFFFF' },
  ],
  fonts: [],
};

function doc(
  layers: TemplateDocument['layers'],
  bg = '#FFFFFF',
): TemplateDocument {
  return {
    ...createBlankDocument(),
    canvas: { width: 1000, height: 1000, unit: 'px', background: { hex: bg } },
    fields: [{ key: 'titulo', label: 'Título', type: 'text', required: true }],
    layers,
  };
}

const text = (over: Record<string, unknown> = {}) =>
  ({
    id: 't1',
    type: 'text',
    name: 'Título',
    x: 100,
    y: 100,
    width: 600,
    height: 150,
    text: 'Hola mundo',
    fontRef: { family: 'serif' },
    fontSize: 60,
    color: { brandColorId: 'c-ink' },
    ...over,
  }) as TemplateDocument['layers'][number];

const find = (items: ReturnType<typeof runRules>, needle: string) =>
  items.filter((i) => i.title.includes(needle));

describe('contrast helpers', () => {
  it('computes WCAG ratios and thresholds', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5);
    expect(requiredContrast(30, 400)).toBe(3);
    expect(requiredContrast(16, 400)).toBe(4.5);
    expect(requiredContrast(19, 700)).toBe(3);
  });
});

describe('runRules', () => {
  it('reports nothing for a healthy piece', () => {
    const items = runRules({
      doc: doc([text()]),
      data: { titulo: 'x' },
      brand,
    });
    expect(items).toEqual([]);
  });

  it('flags low contrast and proposes a brand color that passes', () => {
    const items = runRules({
      doc: doc([text({ color: { hex: '#BBBBBB' } })]),
      data: { titulo: 'x' },
      brand,
    });
    const [item] = find(items, 'Poco contraste');
    expect(item).toMatchObject({
      category: 'LEGIBILITY',
      severity: 'CRITICAL',
      source: 'RULE',
    });
    expect(item.patch).toMatchObject({
      kind: 'layer_prop',
      layerId: 't1',
      prop: 'color',
      to: { brandColorId: 'c-indigo' }, // nearest brand color that passes
    });
  });

  it('uses the shape behind the text as background', () => {
    const shape = {
      id: 's1',
      type: 'shape',
      name: 'Caja',
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      shape: 'rect',
      fill: { brandColorId: 'c-indigo' },
    } as TemplateDocument['layers'][number];
    // dark ink on indigo fails, white passes
    const bad = runRules({
      doc: doc([shape, text()]),
      data: { titulo: 'x' },
      brand,
    });
    expect(find(bad, 'Poco contraste')).toHaveLength(1);
    const good = runRules({
      doc: doc([shape, text({ color: { brandColorId: 'c-white' } })]),
      data: { titulo: 'x' },
      brand,
    });
    expect(find(good, 'Poco contraste')).toHaveLength(0);
  });

  it('does not judge contrast over a photo', () => {
    const image = {
      id: 'i1',
      type: 'image',
      name: 'Foto',
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      fit: 'cover',
      assetId: 'a',
    } as TemplateDocument['layers'][number];
    const items = runRules({
      doc: doc([image, text({ color: { hex: '#EEEEEE' } })]),
      data: { titulo: 'x' },
      brand,
    });
    expect(find(items, 'Poco contraste')).toHaveLength(0);
  });

  it('flags tiny text and proposes the minimum size', () => {
    const min = minFontSize(doc([]));
    expect(min).toBe(20);
    const items = runRules({
      doc: doc([text({ fontSize: 10, height: 50 })]),
      data: { titulo: 'x' },
      brand,
    });
    const [item] = find(items, 'demasiado pequeño');
    expect(item.severity).toBe('CRITICAL');
    expect(item.patch).toMatchObject({ prop: 'fontSize', from: 10, to: 20 });
  });

  it('flags probable overflow and proposes a smaller size that fits', () => {
    const items = runRules({
      doc: doc([
        text({
          width: 300,
          height: 60,
          fontSize: 60,
          text: 'Un texto bastante largo que no cabe en el recuadro',
        }),
      ]),
      data: { titulo: 'x' },
      brand,
    });
    const [item] = find(items, 'podría no caber');
    expect(item).toBeDefined();
    if (item.patch?.kind === 'layer_prop') {
      expect(item.patch.to as number).toBeLessThan(60);
    }
  });

  it('flags layers outside the canvas and layers hugging the edge', () => {
    const out = runRules({
      doc: doc([text({ x: 800, width: 400 })]),
      data: { titulo: 'x' },
      brand,
    });
    const [outside] = find(out, 'se sale del lienzo');
    expect(outside.patch).toMatchObject({ prop: 'x', to: 600 });

    const edge = runRules({
      doc: doc([text({ x: 5, y: 400 })]),
      data: { titulo: 'x' },
      brand,
    });
    const [near] = find(edge, 'pegada al borde');
    expect(near.severity).toBe('INFO');
    expect(near.patch).toMatchObject({ prop: 'x', to: 30 });
  });

  it('ignores full-bleed backgrounds', () => {
    const bg = {
      id: 'b',
      type: 'image',
      name: 'Fondo',
      x: -20,
      y: -20,
      width: 1040,
      height: 1040,
      fit: 'cover',
      assetId: 'a',
    } as TemplateDocument['layers'][number];
    const items = runRules({ doc: doc([bg]), data: {}, brand });
    expect(find(items, 'se sale')).toHaveLength(0);
    expect(find(items, 'pegada')).toHaveLength(0);
  });

  it('flags overlapping texts, off-brand colors and empty required fields', () => {
    const items = runRules({
      doc: doc([
        text({ id: 'a', name: 'A', color: { hex: '#123456' } }),
        text({ id: 'b', name: 'B', y: 120 }),
      ]),
      data: { titulo: '' },
      brand,
    });
    expect(find(items, 'se solapan')).toHaveLength(1);
    const [offBrand] = find(items, 'fuera de marca');
    expect(offBrand.category).toBe('BRAND');
    expect(offBrand.patch).toMatchObject({ prop: 'color' });
    expect(find(items, 'Falta completar')[0].target).toEqual({
      fieldKey: 'titulo',
    });
  });
});
