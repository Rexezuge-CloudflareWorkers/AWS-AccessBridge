import { INTERNAL_HEADER_PREFIX } from '@aws-access-bridge/shared/constants';

export async function generateHMACSignature(
  secret: string,
  headers: Record<string, string>,
  timestamp: string,
  bodyHash: string,
  path: string,
  method: string,
): Promise<string> {
  const internalHeaders: string = Object.entries(headers)
    .filter(([key]) => key.toLowerCase().startsWith(INTERNAL_HEADER_PREFIX))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('\n');
  const payload: string = `${internalHeaders}\n${timestamp}\n${bodyHash}\n${path}\n${method}`;
  const key: CryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature: ArrayBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCodePoint(...new Uint8Array(signature)));
}

/**
 * Compare two base64 signatures without leaking their contents through timing.
 *
 * `===` short-circuits on the first differing byte, which is a byte-at-a-time
 * forgery oracle for an attacker able to measure response latency. Comparing
 * fixed-length byte arrays with an accumulator that never branches on the
 * result keeps the work independent of where (or whether) they differ.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Length is not secret — both are base64-encoded SHA-256 digests — but a
  // mismatch must not fall through to the byte loop.
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (const [i, element] of a.entries()) {
    diff |= element ^ b[i];
  }
  return diff === 0;
}

export async function verifyHMACSignature(
  secret: string,
  signature: string,
  headers: Record<string, string>,
  timestamp: string,
  bodyHash: string,
  path: string,
  method: string,
): Promise<boolean> {
  const expectedSignature: string = await generateHMACSignature(secret, headers, timestamp, bodyHash, path, method);
  // Decoding is inside the guard so a malformed (non-base64) attacker-supplied
  // signature is rejected rather than throwing.
  try {
    return timingSafeEqual(Uint8Array.from(atob(signature), (c) => c.codePointAt(0) ?? 0), Uint8Array.from(atob(expectedSignature), (c) => c.codePointAt(0) ?? 0));
  } catch {
    return false;
  }
}

export async function hashBody(body: string): Promise<string> {
  const hash: ArrayBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return btoa(String.fromCodePoint(...new Uint8Array(hash)));
}
