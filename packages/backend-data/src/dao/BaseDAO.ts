import { DatabaseError } from '@rexezuge/errors';
import { assertSqlIdentifier, BaseDAO as SdkBaseDAO } from '@rexezuge/d1';
import type { D1Result, TrackedStatement, WriteResult } from '@rexezuge/d1';
import { UNMETERED_SUBREQUESTS } from '@rexezuge/shared';
import type { SubrequestMeter } from '@rexezuge/shared';
import { billedRowsForTable } from '../constants/d1/billedRows';
import type { D1Queryable } from '../utils';

/**
 * AWS account DAOs add one domain-specific orphan cleanup helper to the SDK base.
 *
 * ### The subrequest meter
 *
 * D1 counts its own statements against the Workers per-invocation subrequest
 * ceiling, so a DAO layer that spends statements without telling anybody makes
 * every number that budgets work wrong — and it has **no symptom** until the
 * platform terminates the invocation, by which point the rows were right and the
 * suite was green.
 *
 * The meter is therefore a constructor dependency rather than a module singleton,
 * and the charge happens in the SDK base because that is the one path every
 * statement takes. It defaults to unmetered, so the request-path DAOs — which
 * issue a bounded handful of statements per request — need no wiring at all.
 * The places that construct one deliberately are the fan-out loops (cron
 * collection, credential-chain walking), where the statement count is a function
 * of how many accounts are due.
 */
abstract class BaseDAO extends SdkBaseDAO {
  declare protected readonly database: D1Queryable;

  /**
   * @param database The binding.
   * @param meter The invocation's subrequest counter, or an unmetered default.
   * @param billedRows Supplied by the migrations owner: how many rows a write to
   *   a given table costs. See {@link billedRowsForTable}.
   */
  constructor(database: D1Queryable, meter: SubrequestMeter = UNMETERED_SUBREQUESTS) {
    super(database, meter, { billedRowsForTable });
  }

  /**
   * `runTracked` is charged here because the kit does not charge it.
   *
   * `@rexezuge/d1` 1.8.0 charges `run`, `first`, `all` and `batch`, but its
   * `runTracked` only accounts billed rows — so the largest write in this
   * repository (one row per discovered resource) spent a D1 subrequest nobody
   * counted, which is the silent under-count the meter exists to prevent. The
   * kit's own class comment says "every statement is charged"; this restores
   * that here and goes away when upstream charges `runTracked` itself.
   */
  protected override async runTracked(tracked: TrackedStatement): Promise<WriteResult> {
    this.meter.charge(1, 'd1');
    return super.runTracked(tracked);
  }

  protected deleteOrphanedRows(table: string, orphanCondition: string, binds: unknown[] = []): Promise<D1Result> {
    assertSqlIdentifier(table, 'table');
    return this.run(`DELETE FROM ${table} WHERE ${orphanCondition}`, binds);
  }
}

abstract class EncryptedDAO extends BaseDAO {
  /**
   * @param encryptionKeys The keys to try, in preference order. `keys[0]` is the
   *   surface's own key and the only one used to encrypt; the rest are legacy
   *   fallbacks for rows written before the per-feature key split. See
   *   `backend-services/composition/encryptionKeys`.
   */
  constructor(
    database: D1Queryable,
    protected readonly encryptionKeys: readonly string[],
    meter: SubrequestMeter = UNMETERED_SUBREQUESTS,
  ) {
    super(database, meter);
  }

  /**
  The key new ciphertext is written under.
  */
  protected get encryptionKey(): string {
    if (this.encryptionKeys.length === 0) {
      throw new DatabaseError('No encryption key is configured for this DAO.');
    }
    return this.encryptionKeys[0];
  }
}

export { BaseDAO, EncryptedDAO };
