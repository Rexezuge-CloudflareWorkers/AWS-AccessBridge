/**
 * Opaque cursor pagination helpers (Otter `CursorUtil` precedent).
 * Replaces unbounded limit/offset scans; cursors are base64-encoded
 * `offset` values opaque to callers. Uses btoa/atob (Workers-safe;
 * no Node `Buffer` dependency).
 */
function encodeCursor(offset: number): string {
  const json = JSON.stringify({ offset });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) {
    return 0;
  }
  try {
    const padded = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.codePointAt(i) ?? 0;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed === 'object' && parsed !== null && 'offset' in parsed) {
      const offset: unknown = parsed.offset;
      if (typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0) {
        return offset;
      }
    }
  } catch {
    // fall through to 0
  }
  return 0;
}

export { decodeCursor, encodeCursor };
