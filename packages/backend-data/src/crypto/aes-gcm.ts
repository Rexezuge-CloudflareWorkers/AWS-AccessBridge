/**
NIST SP 800-38D recommends a 96-bit GCM IV; longer values are hashed down.
*/
const IV_LENGTH_BYTES = 12;

export async function generateAESGCMKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCodePoint(...new Uint8Array(exported)));
}

/**
 * Encrypt `data` under a fresh, random 96-bit IV.
 *
 * There is deliberately no way to supply a caller-chosen IV: AES-GCM requires
 * a unique nonce per (key, encryption) pair, and reusing one both leaks the
 * XOR of the plaintexts and enables authentication-tag forgery. Encrypting
 * several fields into separate columns is the correct pattern — the IV travels
 * with each ciphertext, as returned here.
 */
export async function encryptData(data: string, keyBase64: string): Promise<{ encrypted: string; iv: string }> {
  const key = await importKey(keyBase64, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encoded = new TextEncoder().encode(data);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    encrypted: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
  };
}

async function importKey(keyBase64: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const keyBuffer = fromBase64(keyBase64);
  return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, usages);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.codePointAt(0) ?? 0);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCodePoint(...bytes));
}

export async function decryptData(encryptedBase64: string, ivBase64: string, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivBase64) }, key, fromBase64(encryptedBase64));
  return new TextDecoder().decode(decrypted);
}

/**
 * Decrypt, returning `undefined` instead of throwing when the payload cannot be
 * authenticated. AES-GCM's tag check is the only integrity signal we have, so
 * any tampering, key rotation, or legacy/garbled ciphertext surfaces here.
 *
 * Intended for read paths that can recover by re-fetching (e.g. the credential
 * cache, whose entries are keyed by a refreshable principal ARN). Do not use
 * for durable data, where a failure must be loud.
 */
export async function decryptDataTolerant(
  encryptedBase64: string | undefined,
  ivBase64: string | undefined,
  keyBase64: string | undefined,
): Promise<string | undefined> {
  if (!encryptedBase64 || !ivBase64 || !keyBase64) {
    return undefined;
  }
  try {
    return await decryptData(encryptedBase64, ivBase64, keyBase64);
  } catch {
    return undefined;
  }
}

export async function decryptDataOptional(
  encryptedBase64: string | undefined,
  ivBase64: string | undefined,
  keyBase64: string | undefined,
): Promise<string | undefined> {
  return encryptedBase64 && ivBase64 && keyBase64 ? decryptData(encryptedBase64, ivBase64, keyBase64) : undefined;
}
