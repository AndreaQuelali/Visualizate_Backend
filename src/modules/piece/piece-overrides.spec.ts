import {
  createBlankDocument,
  TemplateDocument,
} from '../template/template-document';
import {
  applyOverrides,
  effectiveValue,
  propAllowedFor,
  sanitizeOverrides,
} from './piece-overrides';

const doc: TemplateDocument = {
  ...createBlankDocument(),
  layers: [
    {
      id: 't',
      type: 'text',
      name: 'T',
      x: 10,
      y: 10,
      width: 200,
      height: 50,
      text: 'x',
      fontRef: { family: 'serif' },
      fontSize: 20,
      color: { hex: '#000000' },
    },
    {
      id: 's',
      type: 'shape',
      name: 'S',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      shape: 'rect',
      fill: { hex: '#ffffff' },
    },
  ],
};

describe('piece overrides', () => {
  it('applies allowed properties without mutating the template', () => {
    const out = applyOverrides(doc, { t: { fontSize: 32, x: 40 } });
    expect(out.layers[0]).toMatchObject({ fontSize: 32, x: 40 });
    expect(doc.layers[0]).toMatchObject({ fontSize: 20, x: 10 });
  });

  it('ignores unknown props, unknown layers and props the layer type lacks', () => {
    const out = applyOverrides(doc, {
      t: { text: 'hack', fontSize: 30 },
      s: { fontSize: 99, color: '#fff', x: 5 },
      ghost: { x: 1 },
    });
    expect(out.layers[0]).toMatchObject({ text: 'x', fontSize: 30 });
    expect(out.layers[1]).toMatchObject({ x: 5 });
    expect(out.layers[1]).not.toHaveProperty('fontSize');
    expect(out.layers[1]).not.toHaveProperty('color');
  });

  it('returns the same document when there is nothing to apply', () => {
    expect(applyOverrides(doc, {})).toBe(doc);
    expect(applyOverrides(doc, 'garbage')).toBe(doc);
  });

  it('reads the effective value (override first, then template)', () => {
    expect(effectiveValue(doc, {}, 't', 'fontSize')).toBe(20);
    expect(effectiveValue(doc, { t: { fontSize: 33 } }, 't', 'fontSize')).toBe(
      33,
    );
  });

  it('sanitizes and restricts props by layer type', () => {
    expect(sanitizeOverrides({ t: { x: 1, evil: 2 }, bad: 'x' })).toEqual({
      t: { x: 1 },
    });
    expect(propAllowedFor('shape', 'fontSize')).toBe(false);
    expect(propAllowedFor('text', 'color')).toBe(true);
    expect(propAllowedFor('image', 'x')).toBe(true);
  });
});
