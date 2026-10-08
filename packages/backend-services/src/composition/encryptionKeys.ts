import { InternalServerError } from '@aws-access-bridge/backend-errors';
import { ConfigurationManager } from '@aws-access-bridge/backend-runtime/config';
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
 * Reads and writes both use the feature key. The former single master key
 * (`AES_ENCRYPTION_KEY_SECRET`) and its read fallback are gone: every row has been
 * rewritten onto its feature key.
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
 * Index 0 is the feature key and is the only one ever used to encrypt. Today the
 * chain holds that one key; the DAOs still take a list so a future rotation can
 * append a fallback. AES-GCM authenticates its ciphertext, so a wrong key fails
 * loudly rather than returning garbage — which is what makes trying keys in
 * sequence safe.
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

function resolveKey({ binding, rawVar, bindingName, varName }: EncryptionBindings, isProduction: boolean): KeyResolver {
  let pending: Promise<string> | undefined;
  return (): Promise<string> => {
    // The rejected promise is cached too, so a failing binding is not retried
    // once per lookup.
    pending ??= (async (): Promise<string> => {
      if (binding) return binding.get();
      // The raw-var fallback exists for local dev and tests, where no Secrets
      // Store is provisioned. In production it must never mask a missing
      // binding: encrypting with a key that sits in plaintext env vars — or
      // silently treating the two as interchangeable — is a different trust
      // boundary entirely.
      if (rawVar && !isProduction) return rawVar;
      throw new InternalServerError(`${bindingName} is not configured for this environment (set ${varName} for tests).`);
    })();
    return pending;
  };
}

/**
 * Build the per-feature key resolvers for a scope.
 */
function createEncryptionKeys(env: RequestScopeEnvShape): {
  credentialKey: KeyResolver;
  credentialCacheKey: KeyResolver;
} {
  const isProduction: boolean = ConfigurationManager.environment.isProduction(env);
  const credentialKey = resolveKey(
    {
      binding: env.CREDENTIAL_ENCRYPTION_KEY_SECRET,
      rawVar: env.CREDENTIAL_ENCRYPTION_KEY,
      bindingName: 'CREDENTIAL_ENCRYPTION_KEY_SECRET',
      varName: 'CREDENTIAL_ENCRYPTION_KEY',
    },
    isProduction,
  );
  const credentialCacheKey = resolveKey(
    {
      binding: env.CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET,
      rawVar: env.CREDENTIAL_CACHE_ENCRYPTION_KEY,
      bindingName: 'CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET',
      varName: 'CREDENTIAL_CACHE_ENCRYPTION_KEY',
    },
    isProduction,
  );
  return { credentialKey, credentialCacheKey };
}

/**
 * The ordered keys to try when decrypting.
 *
 * A single-element chain: the feature key. The fetch is the only failure mode, and
 * it propagates — a missing key must stop the request, not decrypt nothing.
 */
async function keyChain(featureKey: KeyResolver): Promise<KeyChain> {
  return [await featureKey()];
}

/**
 * Both surfaces' key chains, read straight from `env`.
 *
 * The fallback for a service constructed outside a request scope — tests, ops
 * scripts. On the request path the composition root injects a memoized provider
 * instead, so the secrets are fetched once.
 */
async function resolveCredentialKeys(env: RequestScopeEnvShape): Promise<{ credentials: KeyChain; cache: KeyChain }> {
  const keys = createEncryptionKeys(env);
  const [credentials, cache] = await Promise.all([keyChain(keys.credentialKey), keyChain(keys.credentialCacheKey)]);
  return { credentials, cache };
}

export { createEncryptionKeys, keyChain, resolveCredentialKeys };
export type { CredentialKeyProvider, KeyChain, KeyResolver };

/**
 * Supplies both surfaces' key chains.
 *
 * Injected rather than looked up, so a service resolves keys from the same scope
 * that constructed it — a service holding only `env` cannot identify its request.
 */
type CredentialKeyProvider = () => Promise<{ credentials: KeyChain; cache: KeyChain }>;
