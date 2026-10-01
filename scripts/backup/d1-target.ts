/**
 * Choosing which D1 database the backup workflow exports.
 *
 * Pure, so `test/backup/` can assert the empty-database guard without running
 * Actions or touching a real account.
 */

import { DEFAULT_UUID } from '../lib/wrangler-config/types';

export interface D1DatabaseBinding {
  binding?: string;
  database_id?: string;
  database_name?: string;
}

export interface D1Target {
  /**
   * The binding name, used for log output and as the export fallback.
   */
  binding: string;
  /**
   * The database id, verified against Cloudflare by the caller.
   */
  databaseId: string;
  /**
   * What `wrangler d1 export` should be pointed at.
   */
  target: string;
}

/**
 * Pick the export target from a parsed wrangler config.
 *
 * `wrangler d1 export` takes a database *name*, so `database_name` wins when
 * present. Hand-written configs that omit it fall back to the binding name.
 *
 * @throws when there is no binding, or when `database_id` is still the template
 *   placeholder (meaning the database was auto-provisioned and holds no data).
 */
export function resolveD1Target(config: { d1_databases?: D1DatabaseBinding[] }): D1Target {
  const database = config.d1_databases?.[0];

  const binding = database?.binding?.trim();
  if (!binding) {
    throw new Error('No d1_databases entry with a binding found in wrangler.jsonc.');
  }

  const databaseId = database?.database_id?.trim() ?? '';
  if (databaseId === DEFAULT_UUID) {
    throw new Error(
      `D1 database_id for ${binding} is still the template placeholder. The database does not exist yet, so there is nothing to back up.`,
    );
  }

  const target = database?.database_name?.trim() || binding;
  return { binding, databaseId, target };
}
