export async function generateAESGCMKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCodePoint(...new Uint8Array(exported)));
}

export async function encryptData(data: string, keyBase64: string, ivBase64?: string): Promise<{ encrypted: string; iv: string }> {
  const keyBuffer = Uint8Array.from(atob(keyBase64), (c) => c.codePointAt(0) ?? 0);
  const key = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = ivBase64 ? Uint8Array.from(atob(ivBase64), (c) => c.codePointAt(0) ?? 0) : crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    encrypted: btoa(String.fromCodePoint(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCodePoint(...iv)),
  };
}

export async function decryptData(encryptedBase64: string, ivBase64: string, keyBase64: string): Promise<string> {
  const keyBuffer = Uint8Array.from(atob(keyBase64), (c) => c.codePointAt(0) ?? 0);
  const key = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = Uint8Array.from(atob(ivBase64), (c) => c.codePointAt(0) ?? 0);
  const encrypted = Uint8Array.from(atob(encryptedBase64), (c) => c.codePointAt(0) ?? 0);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

export async function decryptDataOptional(
  encryptedBase64: string | undefined,
  ivBase64: string | undefined,
  keyBase64: string | undefined,
): Promise<string | undefined> {
  if (encryptedBase64 && ivBase64 && keyBase64) {
    return decryptData(encryptedBase64, ivBase64, keyBase64);
  }
  return undefined;
}
