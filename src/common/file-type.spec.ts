import { detectFileType, isUnsafeSvg } from './file-type';

describe('detectFileType', () => {
  it('detects PNG, JPEG, WebP, WOFF2 and TTF by content', () => {
    expect(
      detectFileType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toMatchObject({ mime: 'image/png' });
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject(
      {
        mime: 'image/jpeg',
      },
    );
    expect(
      detectFileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')),
    ).toMatchObject({ mime: 'image/webp' });
    expect(detectFileType(Buffer.from('wOF2....'))).toMatchObject({
      mime: 'font/woff2',
    });
    expect(detectFileType(Buffer.from([0, 1, 0, 0, 0]))).toMatchObject({
      mime: 'font/ttf',
    });
  });

  it('detects SVG text and rejects unknown content', () => {
    expect(
      detectFileType(Buffer.from('<?xml version="1.0"?><svg xmlns="x"></svg>')),
    ).toMatchObject({ mime: 'image/svg+xml' });
    expect(detectFileType(Buffer.from('MZ executable'))).toBeNull();
    expect(detectFileType(Buffer.from('<html><script>'))).toBeNull();
  });

  it('flags SVGs with active content', () => {
    expect(isUnsafeSvg('<svg><script>alert(1)</script></svg>')).toBe(true);
    expect(isUnsafeSvg('<svg onload="x()"></svg>')).toBe(true);
    expect(isUnsafeSvg('<svg><rect width="1" height="1"/></svg>')).toBe(false);
  });
});
