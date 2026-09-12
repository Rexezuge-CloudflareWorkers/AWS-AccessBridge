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
  return signature === expectedSignature;
}

export async function hashBody(body: string): Promise<string> {
  const hash: ArrayBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return btoa(String.fromCodePoint(...new Uint8Array(hash)));
}
