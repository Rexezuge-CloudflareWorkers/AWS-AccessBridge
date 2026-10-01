import { InternalServerError } from '@aws-access-bridge/backend-errors';
import type { RequestScopeEnvShape } from './tokens';

/**
 * Per-feature encryption keys.
 *
 * One key per encrypted surface, so a leaked key's blast radius is one surface
 * and the binding name says what it protects:
 *
 * - `CREDENTIAL_ENCRYPTION_KEY_SECRET` — the `credentials` D1 table
 *   (long-term IAM access keys).
 * - `CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET` — the `credentials_cache` KV
 *   namespace (temporary STS credentials).
 *
 * Each falls back to the legacy `AES_ENCRYPTION_KEY_SECRET` on *read*, so rows
 * written before the split stay readable. Writes always use the feature key.
 * Seed the new bindings with the current master-key value when deploying: that
 * makes the split a rename plus a copy, with no key material changing hands and
 * no row becoming unreadable. A row is re-encrypted onto its feature key the next
 * time it is stored, the same self-healing shape migration `0031` uses for IVs.
 *
 * Each key is fetched lazily and memoized, so resolving one never fetches
 * another.
 */

/**
A key source, memoized for the lifetime of the request scope.
*/
type KeyResolver = () => Promise<string>;

/**
 * One preference-ordered list of keys to try when decrypting.
 *
 * Index 0 is the feature key and is the only one ever used to encrypt. The rest
 * are legacy fallbacks, tried in order on a decryption failure. AES-GCM
 * authenticates its ciphertext, so a wrong key fails loudly rather than returning
 * garbage — which is what makes trying keys in sequence safe.
 */
type KeyChain = readonly string[];

interface EncryptionBindings {
  /**
   * Memoize one key source.
   *
   * A declared-but-unreadable binding still throws: the raw-var fallback exists
   * for local dev and tests, and must never mask a broken production binding.
   */
  binding: { get(): Promise<string> } | undefined;
  rawVar: string | undefined;
  bindingName: string;
  varName: string;
}

function resolveKey({ binding, rawVar, bindingName, varName }: EncryptionBindings): KeyResolver {
  let pending: Promise<string> | undefined;
  return (): Promise<string> => {
    // The rejected promise is cached too, so a failing binding is not retried
    // once per lookup.
    pending ??= (async (): Promise<string> => {
      if (binding) return binding.get();
      if (rawVar) return rawVar;
      throw new InternalServerError(`${bindingName} is not configured for this environment (set ${varName} for tests).`);
    })();
    return pending;
  };
}

/**
 * Build the per-feature key resolvers for a scope.
 *
 * `CREDENTIAL_ENCRYPTION_KEY_SECRET` is seeded with the current master-key value
 * at deploy time, so `legacy` is normally the *same* key as the feature key —
 * which means the fallback costs nothing until the two are rotated apart.
 */
function createEncryptionKeys(env: RequestScopeEnvShape): {
  credentialKey: KeyResolver;
  credentialCacheKey: KeyResolver;
  legacyMasterKey: KeyResolver;
} {
  const legacyMasterKey = resolveKey({
    binding: env.AES_ENCRYPTION_KEY_SECRET,
    rawVar: env.AES_ENCRYPTION_KEY,
    bindingName: 'AES_ENCRYPTION_KEY_SECRET',
    varName: 'AES_ENCRYPTION_KEY',
  });
  const credentialKey = resolveKey({
    binding: env.CREDENTIAL_ENCRYPTION_KEY_SECRET,
    rawVar: env.CREDENTIAL_ENCRYPTION_KEY,
    bindingName: 'CREDENTIAL_ENCRYPTION_KEY_SECRET',
    varName: 'CREDENTIAL_ENCRYPTION_KEY',
  });
  const credentialCacheKey = resolveKey({
    binding: env.CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET,
    rawVar: env.CREDENTIAL_CACHE_ENCRYPTION_KEY,
    bindingName: 'CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET',
    varName: 'CREDENTIAL_CACHE_ENCRYPTION_KEY',
  });
  return { credentialKey, credentialCacheKey, legacyMasterKey };
}

/**
 * The ordered keys to try when decrypting, deduplicated.
 *
 * Dedup because the feature key and the legacy master key are usually the same
 * value right after deploying the split — without this every decrypt would pay for
 * a second, guaranteed-to-fail attempt.
 *
 * The legacy key is optional: a deployment that has finished rewriting every row
 * drops `AES_ENCRYPTION_KEY_SECRET` and this resolves to a single-element chain.
 * Requiring it would make the migration a one-way door with no exit.
 */
async function keyChain(featureKey: KeyResolver, legacyKey: KeyResolver): Promise<KeyChain> {
  const current: string = await featureKey();
  const legacy: string | undefined = await legacyKey().catch(() => undefined);
  return legacy === undefined || legacy === current ? [current] : [current, legacy];
}

export { createEncryptionKeys, keyChain };
export type { KeyChain, KeyResolver };