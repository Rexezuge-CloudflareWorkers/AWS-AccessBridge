/**
 * The one-place hash for personal access tokens.
 *
 * A PAT is 244 random bits from two UUIDs, so a plain SHA-256 hex digest is
 * the right storage form: the input is not dictionary-searchable, so no salt
 * or password KDF is needed, and the digest is indexable. Binding the digest
 * for storage means a D1 read or backup no longer carries a live credential.
 */
class TokenHashUtil {
  public static async sha256Hex(token: string): Promise<string> {
    const data: Uint8Array = new TextEncoder().encode(token);
    const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

export { TokenHashUtil };
