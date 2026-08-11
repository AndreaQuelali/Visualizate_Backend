export type DetectedFile =
  | { mime: 'image/png'; ext: 'png'; family: 'image' }
  | { mime: 'image/jpeg'; ext: 'jpg'; family: 'image' }
  | { mime: 'image/webp'; ext: 'webp'; family: 'image' }
  | { mime: 'image/svg+xml'; ext: 'svg'; family: 'image' }
  | { mime: 'font/woff2'; ext: 'woff2'; family: 'font' }
  | { mime: 'font/ttf'; ext: 'ttf'; family: 'font' };

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length &&
  bytes.every((b, i) => buf[offset + i] === b);

/**
 * Detects the real file type from its content (magic bytes), ignoring the
 * extension and the client-declared MIME type.
 */
export function detectFileType(buffer: Buffer): DetectedFile | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png', family: 'image' };
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ext: 'jpg', family: 'image' };
  }
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mime: 'image/webp', ext: 'webp', family: 'image' };
  }
  if (startsWith(buffer, [0x77, 0x4f, 0x46, 0x32])) {
    return { mime: 'font/woff2', ext: 'woff2', family: 'font' };
  }
  if (
    startsWith(buffer, [0x00, 0x01, 0x00, 0x00]) ||
    startsWith(buffer, [0x74, 0x72, 0x75, 0x65])
  ) {
    return { mime: 'font/ttf', ext: 'ttf', family: 'font' };
  }
  const head = buffer.subarray(0, 2048).toString('utf8');
  if (/<svg[\s>]/i.test(head)) {
    return { mime: 'image/svg+xml', ext: 'svg', family: 'image' };
  }
  return null;
}

/** True when an SVG contains active content that must never be stored. */
export function isUnsafeSvg(svg: string): boolean {
  return /<script|<foreignObject|<iframe|<!ENTITY|\son\w+\s*=|javascript:/i.test(
    svg,
  );
}
