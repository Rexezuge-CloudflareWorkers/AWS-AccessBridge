import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_DATABASE_ID, resolveD1Target } from '../../scripts/backup/resolve-d1-target';

const REAL_ID = '11111111-2222-3333-4444-555555555555';

describe('resolveD1Target', () => {
  it('exports by database name, which is what `wrangler d1 export` accepts', () => {
    const target = resolveD1Target({
      d1_databases: [{ binding: 'AccessBridgeDB', database_name: 'aws-access-bridge-db', database_id: REAL_ID }],
    });

    expect(target).toEqual({ binding: 'AccessBridgeDB', databaseId: REAL_ID, target: 'aws-access-bridge-db' });
  });

  it('falls back to the binding when a hand-written config omits database_name', () => {
    expect(resolveD1Target({ d1_databases: [{ binding: 'AccessBridgeDB', database_id: REAL_ID }] }).target).toBe('AccessBridgeDB');
  });

  it('rejects a config with no d1_databases entry', () => {
    expect(() => resolveD1Target({})).toThrow(/No d1_databases entry/);
    expect(() => resolveD1Target({ d1_databases: [{ database_id: REAL_ID }] })).toThrow(/binding/);
  });

  it('refuses to back up a database prepare-wrangler-config just created', () => {
    expect(() =>
      resolveD1Target({
        d1_databases: [{ binding: 'AccessBridgeDB', database_name: 'aws-access-bridge-db', database_id: PLACEHOLDER_DATABASE_ID }],
      }),
    ).toThrow(/still the template placeholder/);
  });

  it('accepts a config whose database_id is absent, leaving verification to wrangler', () => {
    expect(resolveD1Target({ d1_databases: [{ binding: 'AccessBridgeDB' }] }).databaseId).toBe('');
  });
});
