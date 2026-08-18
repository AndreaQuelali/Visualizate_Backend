import {
  createBlankDocument,
  TemplateDocument,
} from '../template/template-document';
import {
  cssString,
  documentToHtml,
  escapeHtml,
  RenderContext,
} from './document-to-html';

const ctx: RenderContext = {
  brand: {
    colors: [{ id: 'c1', hex: '#4648d4' }],
    fonts: [{ id: 'f1', family: 'Inter', assetId: 'a-font' }],
  },
  assetUrls: {
    'a-img': 'http://minio:9000/b/img.png?sig=1',
    'a-font': 'http://minio:9000/b/font.woff2?sig=2',
  },
  allowedOrigin: 'http://minio:9000',
};

function doc(): TemplateDocument {
  return {
    ...createBlankDocument(),
    canvas: {
      width: 800,
      height: 600,
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
        x: 10,
        y: 20,
        width: 300,
        height: 80,
        rotation: 15,
        text: 'Placeholder',
        fontRef: { brandFontId: 'f1' },
        fontSize: 40,
        fontWeight: 700,
        color: { hex: '#111111' },
        align: 'center',
        bind: { fieldKey: 'titulo' },
      },
      {
        id: 'l2',
        type: 'image',
        name: 'Foto',
        x: 0,
        y: 100,
        width: 400,
        height: 300,
        fit: 'contain',
        bind: { fieldKey: 'foto' },
      },
      {
        id: 'l3',
        type: 'shape',
        name: 'Caja',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        shape: 'ellipse',
        fill: { brandColorId: 'c1' },
      },
    ],
  };
}

describe('documentToHtml', () => {
  it('renders canvas size, brand background and layer geometry', () => {
    const html = documentToHtml(doc(), { titulo: 'Hola', foto: 'a-img' }, ctx);
    expect(html).toContain('width:800px;height:600px');
    expect(html).toContain('background-color:#4648d4');
    expect(html).toContain('left:10px;top:20px;width:300px;height:80px');
    expect(html).toContain('transform:rotate(15deg)');
    expect(html).toContain('border-radius:50%');
    expect(html).toContain('@page{size:800px 600px');
  });

  it('uses the bound value (not the placeholder) for text', () => {
    const html = documentToHtml(doc(), { titulo: 'Concierto' }, ctx);
    expect(html).toContain('>Concierto<');
    expect(html).not.toContain('Placeholder');
    expect(html).toContain('font-family:&quot;Inter&quot;, sans-serif');
    expect(html).toContain('font-size:40px');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('text-align:center');
  });

  it('escapes user text so HTML and scripts are never injected', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(1)> "q"';
    const html = documentToHtml(doc(), { titulo: evil }, ctx);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;q&quot;');
  });

  it('renders bound images from signed URLs and ignores unknown assets', () => {
    const withImg = documentToHtml(doc(), { titulo: 'x', foto: 'a-img' }, ctx);
    expect(withImg).toContain('src="http://minio:9000/b/img.png?sig=1"');
    expect(withImg).toContain('object-fit:contain');

    const noImg = documentToHtml(
      doc(),
      { titulo: 'x', foto: 'desconocido' },
      ctx,
    );
    expect(noImg).not.toContain('<img');
  });

  it('declares brand fonts with @font-face and a strict CSP', () => {
    const html = documentToHtml(doc(), { titulo: 'x' }, ctx);
    expect(html).toContain('@font-face{font-family:"Inter"');
    expect(html).toContain('font.woff2');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('img-src http://minio:9000 data:');
  });

  it('does not quote CSS generic font families', () => {
    const d = doc();
    (d.layers[0] as { fontRef: unknown }).fontRef = { family: 'serif' };
    const html = documentToHtml(d, { titulo: 'x' }, ctx);
    expect(html).toContain('font-family:serif');
    expect(html).not.toContain('&quot;serif&quot;');
  });

  it('never breaks out of a style attribute (quotes in font names)', () => {
    const d = doc();
    (d.layers[0] as { fontRef: unknown }).fontRef = {
      family: 'Evil" onmouseover="x',
    };
    const html = documentToHtml(d, { titulo: 'x' }, ctx);
    // Every style attribute must close right before ">" or a space.
    const bad = html.match(/style="[^"]*"[^ >]/g);
    expect(bad).toBeNull();
    expect(html).not.toContain('onmouseover="x');
  });

  it('falls back to safe values for invalid colors', () => {
    const d = doc();
    d.canvas.background = { hex: 'red;}</style><script>' };
    expect(documentToHtml(d, {}, ctx)).toContain('background-color:#000000');
  });
});

describe('escaping helpers', () => {
  it('escapeHtml covers the dangerous characters', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;',
    );
  });

  it('cssString neutralizes quotes, backslashes and tags', () => {
    expect(cssString('a"b\\c<d>')).not.toMatch(/["\\<>](?!\w)/);
    expect(cssString('Inter')).toBe('Inter');
  });
});
