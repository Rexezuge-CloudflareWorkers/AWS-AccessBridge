/**
NIST SP 800-38D recommends a 96-bit GCM IV; longer values are hashed down.
*/
/**
 * AES-GCM helpers for credential encryption.
 *
 * NIST SP 800-38D recommends a 96-bit GCM IV; longer values are hashed down.
 *
 * Decryption takes a *chain* of keys rather than one: each encrypted surface has
 * its own key (see `backend-services/composition/encryptionKeys`), and rows
 * written before that split are still encrypted under the legacy master key.
 * AES-GCM authenticates its ciphertext, so trying keys in preference order is
 * safe — a wrong key fails the tag check rather than returning garbage.
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
 * Decrypt, trying each key in turn and returning the first that authenticates.
 *
 * This is what makes a per-feature key split non-breaking. AES-GCM's
 * authentication tag is the only integrity signal available, so a wrong key
 * fails loudly instead of returning garbage — which makes trying keys in
 * preference order safe. `keys[0]` is the feature key and the only one used to
 * encrypt; the rest are legacy fallbacks for rows written before the split.
 *
 * A row is upgraded onto the current key the next time it is written, the same
 * self-healing shape migration `0031` uses for IVs.
 */
export async function decryptDataWithKeys(encryptedBase64: string | undefined, ivBase64: string | undefined, keys: readonly string[]): Promise<string> {
  if (!encryptedBase64 || !ivBase64) {
    throw new Error('Cannot decrypt: the ciphertext or its IV is missing.');
  }
  let lastError: unknown;
  for (const keyBase64 of keys) {
    try {
      return await decryptData(encryptedBase64, ivBase64, keyBase64);
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw new Error(`No key in the chain (${keys.length} tried) could authenticate this ciphertext: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
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
/**
 * As `decryptDataWithKeys`, but `undefined` instead of a throw when no key
 * authenticates. AES-GCM's tag check is the only integrity signal we have, so
 * any tampering, key rotation, or legacy/garbled ciphertext surfaces here.
 *
 * Intended for read paths that can recover by re-fetching (e.g. the credential
 * cache, whose entries are keyed by a refreshable principal ARN). Do not use
 * for durable data, where a failure must be loud.
 */
/**
 * Decrypt one optional column: absent → `undefined`, present but no key
 * authenticates → throw.
 *
 * The distinction the `credentials` table needs. A row there is written two ways:
 * a full credential, or a bare `(principal_arn, assumed_by)` relationship, which
 * legitimately has no ciphertext in any of its three columns. A missing envelope
 * is therefore a normal answer, while an envelope no key can authenticate is real
 * corruption or an unrotated key and must be loud.
 */
export async function decryptDataField(encryptedBase64: string | undefined, ivBase64: string | undefined, keys: readonly string[]): Promise<string | undefined> {
  return !encryptedBase64 || !ivBase64 ? undefined : decryptDataWithKeys(encryptedBase64, ivBase64, keys);
}

export async function decryptDataTolerant(
  encryptedBase64: string | undefined,
  ivBase64: string | undefined,
  keys: readonly string[] | undefined,
): Promise<string | undefined> {
  if (!encryptedBase64 || !ivBase64 || !keys?.length) {
    return undefined;
  }
  for (const keyBase64 of keys) {
    try {
      return await decryptData(encryptedBase64, ivBase64, keyBase64);
    } catch {
      // Try the next key in the chain.
    }
  }
  return undefined;
}
