import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers/migrations';
import { CredentialCacheRefreshTask } from '@aws-access-bridge/background/scheduled/CredentialCacheRefreshTask';
import { createRequestScope, Tokens } from '@aws-access-bridge/backend-services/composition';
import type { CredentialChainService } from '@aws-access-bridge/backend-services/credential';
import { CredentialsCacheDAO } from '@aws-access-bridge/backend-data/dao/CredentialsCacheDAO';
import { CredentialsDAO } from '@aws-access-bridge/backend-data/dao/CredentialsDAO';

/**
 * The pre-warm cron against real D1 and KV, with only STS stubbed.
 *
 * The registration table (`credential_cache_config`) used to be filled by
 * `storeCredential`, i.e. with the *base* principals — whose chain has length one
 * and which `CredentialChainService.getCredentialChain` refuses with a
 * `ForbiddenError`. The cron therefore failed on every row it was ever given and,
 * because `last_cached_at` only advanced on success, kept picking the same oldest
 * rows forever. A mock cannot show that: it needs the registration, the chain
 * walk, the KV write and the timestamp to meet in one database.
 */

const CREDENTIAL_KEY = 'dGVzdC1tYXN0ZXIta2V5LWJhc2U2NC1lbmNvZGVkZWI=';
const CACHE_KEY = 'ZmVhdHVyZS1rZXktZm9yLWNyZWRlbnRpYWxzLTAwMDA=';

const BASE = 'arn:aws:iam::111111111111:user/base';
const MID = 'arn:aws:iam::222222222222:role/Mid';
const TARGET = 'arn:aws:iam::333333333333:role/Target';

/**
The env a service sees: raw key vars instead of Secrets Store bindings, which the harness does not populate.
*/
function scopeEnv(extra: Record<string, unknown> = {}): never {
  return {
    ...env,
    CREDENTIAL_ENCRYPTION_KEY_SECRET: undefined,
    CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET: undefined,
    CREDENTIAL_ENCRYPTION_KEY: CREDENTIAL_KEY,
    CREDENTIAL_CACHE_ENCRYPTION_KEY: CACHE_KEY,
    ...extra,
  } as never;
}

function stsResponse(accessKeyId: string): Response {
  const expiration = new Date(Date.now() + 3_600_000).toISOString();
  return new Response(
    `<AssumeRoleResponse><AssumeRoleResult><Credentials><AccessKeyId>${accessKeyId}</AccessKeyId><SecretAccessKey>secret-${accessKeyId}</SecretAccessKey><SessionToken>token-${accessKeyId}</SessionToken><Expiration>${expiration}</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`,
    { status: 200 },
  );
}

async function lastCachedAt(principalArn: string): Promise<number | undefined> {
  const row = await env.AccessBridgeDB.prepare('SELECT last_cached_at FROM credential_cache_config WHERE principal_arn = ?')
    .bind(principalArn)
    .first<{ last_cached_at: number }>();
  return row?.last_cached_at;
}

async function registered(): Promise<string[]> {
  const rows = await env.AccessBridgeDB.prepare('SELECT principal_arn FROM credential_cache_config ORDER BY principal_arn').all<{
    principal_arn: string;
  }>();
  return rows.results.map((row) => row.principal_arn);
}

async function latestRun(): Promise<{ items_processed: number; items_failed: number; status: string } | null> {
  return env.AccessBridgeDB.prepare(
    `SELECT items_processed, items_failed, status FROM background_task_runs
     WHERE task_type = 'credential-cache-refresh' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).first();
}

describe('Credential pre-warm cron against real D1 and KV', () => {
  const assumed: string[] = [];

  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    assumed.length = 0;
  });

  function stubSts(): void {
    // aws4fetch hands `fetch` a signed `Request`, so the form body is read from it.
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit): Promise<Response> => {
      const body = input instanceof Request ? await input.text() : typeof init?.body === 'string' ? init.body : '';
      const params = new URLSearchParams(body);
      const roleArn = params.get('RoleArn') ?? '';
      assumed.push(roleArn);
      return stsResponse(`ASIA${assumed.length}EXAMPLEKEY`);
    });
  }

  async function seedChain(): Promise<void> {
    const store = createRequestScope(scopeEnv()).get(Tokens.CredentialStoreService);
    await store.storeCredential(BASE, 'AKIABASEEXAMPLE00000', 'baseSecretValue');
    await store.storeCredentialRelationship(MID, BASE);
    await store.storeCredentialRelationship(TARGET, MID);
  }

  it('registers the roles of a chain for pre-warm, and never the base principal', async () => {
    await seedChain();
    // The base principal holds keys, not an assumable role: its chain has length one.
    expect(await registered()).toEqual([MID, TARGET]);
  });

  it('caches only the intermediate hop, and advances every registered principal', async () => {
    await seedChain();
    // A row registered before the fix: a base principal. It must be tolerated, not failed.
    await env.AccessBridgeDB.prepare('INSERT OR IGNORE INTO credential_cache_config (principal_arn, last_cached_at) VALUES (?, 0)')
      .bind(BASE)
      .run();
    await env.AccessBridgeDB.prepare('UPDATE credential_cache_config SET last_cached_at = 0').run();
    stubSts();

    await new CredentialCacheRefreshTask().handle({} as ScheduledController, scopeEnv(), {} as ExecutionContext);

    // Target's chain is [Target, Mid, Base]: exactly one hop — Mid — is assumable ahead of time.
    expect(assumed).toEqual([MID]);
    const cache = new CredentialsCacheDAO(env.AccessBridgeKV, [CACHE_KEY]);
    expect(await cache.getCachedCredential(MID)).toBeDefined();
    expect(await cache.getCachedCredential(TARGET)).toBeUndefined();
    expect(await cache.getCachedCredential(BASE)).toBeUndefined();

    for (const arn of [BASE, MID, TARGET]) {
      expect(await lastCachedAt(arn)).toBeGreaterThan(0);
    }
    // The legacy base row is a skip, not a failure.
    expect(await latestRun()).toMatchObject({ items_failed: 0, items_processed: 1 });
  });

  it('stamps a failing principal so one broken row cannot starve the batch', async () => {
    await seedChain();
    const dangling = 'arn:aws:iam::444444444444:role/Dangling';
    const store = createRequestScope(scopeEnv()).get(Tokens.CredentialStoreService);
    // Points at a principal with no credentials row, so its chain cannot be resolved.
    await store.storeCredentialRelationship(dangling, 'arn:aws:iam::555555555555:role/Nowhere');
    // Order: Dangling is the oldest, Target the next; batch size 1.
    await env.AccessBridgeDB.prepare('UPDATE credential_cache_config SET last_cached_at = 5').run();
    await env.AccessBridgeDB.prepare('UPDATE credential_cache_config SET last_cached_at = 1 WHERE principal_arn = ?').bind(dangling).run();
    await env.AccessBridgeDB.prepare('UPDATE credential_cache_config SET last_cached_at = 2 WHERE principal_arn = ?').bind(TARGET).run();
    stubSts();
    const batchOfOne = scopeEnv({ NUMBER_OF_CREDENTIALS_TO_REFRESH: '1' });

    await new CredentialCacheRefreshTask().handle({} as ScheduledController, batchOfOne, {} as ExecutionContext);
    // Still reported as a failure ...
    expect(await latestRun()).toMatchObject({ items_failed: 1, items_processed: 0 });
    // ... but no longer first in line.
    expect(await lastCachedAt(dangling)).toBeGreaterThan(5);

    await new CredentialCacheRefreshTask().handle({} as ScheduledController, batchOfOne, {} as ExecutionContext);
    expect(await latestRun()).toMatchObject({ items_failed: 0, items_processed: 1 });
    expect(assumed).toEqual([MID]);
  });

  it('keeps deleting the registration when a credential is removed', async () => {
    await seedChain();
    const store = createRequestScope(scopeEnv()).get(Tokens.CredentialStoreService);
    await store.removeCredential(TARGET);
    const remaining = await registered();
    expect(remaining).not.toContain(TARGET);
    expect(remaining).toContain(MID);
  });
});

/**
 * The cache used to decide whether an over-long chain was servable.
 *
 * `MID_TWO` sits at the last position a limit-3 budget reaches, so a cached entry
 * for it short-circuited the walk one read before the depth check and served a
 * four-principal chain that the cold walk refused. Nothing about the entry was
 * illegitimate: `MID`'s own chain is `[Mid, MidTwo, Base]` — exactly the limit — so
 * the cron cached it on its ordinary schedule. This needs real D1 and real KV
 * because the whole defect is the interaction between a row the walk reads and an
 * entry the walk does not; a mock that stubs the cache independently of the
 * credentials rows cannot express it.
 */
describe('An over-long chain is refused whether or not a cached hop is warm', () => {
  const assumed: string[] = [];

  // Deliberately not the BASE/MID/TARGET of the block above. Storage is not
  // isolated between tests in this file, and the chain above caches an entry for
  // `MID` — reused here it would short-circuit at hop two and this suite would
  // pass for the wrong reason while measuring nothing about a four-principal chain.
  const DEEP_BASE = 'arn:aws:iam::777777777777:user/DeepBase';
  const DEEP_MID = 'arn:aws:iam::888888888888:role/DeepMid';
  const DEEP_MID_TWO = 'arn:aws:iam::999999999999:role/DeepMidTwo';
  const DEEP_TARGET = 'arn:aws:iam::121212121212:role/DeepTarget';

  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    assumed.length = 0;
  });

  /**
  DEEP_TARGET <- DEEP_MID <- DEEP_MID_TWO <- DEEP_BASE: four against a limit of three.
  */
  async function seedOverLongChain(): Promise<void> {
    const store = createRequestScope(scopeEnv()).get(Tokens.CredentialStoreService);
    // Registrations left by the block above share this table and this batch, and
    // one of them (`TARGET`, whose credential that block removes) fails on its own.
    // Drop them so the run counters below describe this chain and nothing else.
    await env.AccessBridgeDB.prepare('DELETE FROM credential_cache_config WHERE principal_arn NOT IN (?, ?, ?)')
      .bind(DEEP_MID, DEEP_MID_TWO, DEEP_TARGET)
      .run();
    await store.storeCredential(DEEP_BASE, 'AKIABASEXAMPLE000000', 'baseSecretValue');
    await store.storeCredentialRelationship(DEEP_MID_TWO, DEEP_BASE);
    await store.storeCredentialRelationship(DEEP_MID, DEEP_MID_TWO);
    await store.storeCredentialRelationship(DEEP_TARGET, DEEP_MID);
    await env.AccessBridgeDB.prepare('UPDATE credential_cache_config SET last_cached_at = 0').run();
  }

  function stubSts(): void {
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit): Promise<Response> => {
      const body = input instanceof Request ? await input.text() : typeof init?.body === 'string' ? init.body : '';
      const params = new URLSearchParams(body);
      assumed.push(params.get('RoleArn') ?? '');
      return stsResponse(`ASIA${assumed.length}EXAMPLEKEY`);
    });
  }

  function chainService(): CredentialChainService {
    return createRequestScope(scopeEnv()).get(Tokens.CredentialChainService);
  }

  it('refuses it cold, and still refuses it once the cron has warmed a hop on the way past', async () => {
    await seedOverLongChain();

    await expect(chainService().getCredentialChainToFirstCachedPrincipal(DEEP_TARGET)).rejects.toThrow(
      'Principal chain exceeds the maximum allowed depth',
    );

    stubSts();
    await new CredentialCacheRefreshTask().handle({} as ScheduledController, scopeEnv(), {} as ExecutionContext);

    // The cron warmed `DEEP_MID_TWO` legally, off `DEEP_MID`'s own three-principal
    // chain, and could not warm `DEEP_TARGET`, whose chain runs past the limit.
    const cache = new CredentialsCacheDAO(env.AccessBridgeKV, [CACHE_KEY]);
    expect(await cache.getCachedCredential(DEEP_MID_TWO)).toBeDefined();
    expect(await cache.getCachedCredential(DEEP_TARGET)).toBeUndefined();
    expect(await latestRun()).toMatchObject({ items_processed: 1, items_failed: 1 });

    // The point of the test: the entry exists, and the answer does not change.
    await expect(chainService().getCredentialChainToFirstCachedPrincipal(DEEP_TARGET)).rejects.toThrow(
      'Principal chain exceeds the maximum allowed depth',
    );
  });

  it('refuses it through the cron walk too, not only the interactive one', async () => {
    // `getCredentialChain` is what the collection tasks and the pre-warm use. It
    // used to be the stricter of the two, which is the wrong way round: a limit
    // that refuses only when nothing is cached is not a limit.
    await seedOverLongChain();
    stubSts();
    await new CredentialCacheRefreshTask().handle({} as ScheduledController, scopeEnv(), {} as ExecutionContext);

    for (const resolve of [
      () => chainService().getCredentialChain(DEEP_TARGET),
      () => chainService().getCredentialChainToFirstCachedPrincipal(DEEP_TARGET),
    ]) {
      await expect(resolve()).rejects.toThrow('Principal chain exceeds the maximum allowed depth');
    }
  });
});

describe('Credential upserts do not rewrite the rest of the row', () => {
  beforeAll(async () => {
    await applyMigrations(env.AccessBridgeDB);
  });

  const ROLE = 'arn:aws:iam::123456789012:role/Upserted';
  const PARENT = 'arn:aws:iam::123456789012:user/parent';

  it('keeps assumed_by and the cache registration when the keys are stored again', async () => {
    const dao = new CredentialsDAO(env.AccessBridgeDB as never, [CREDENTIAL_KEY], 3);
    await dao.storeCredential(PARENT, 'AKIAPARENTEXAMPLE0000', 'parentSecret');
    await dao.storeCredentialRelationship(ROLE, PARENT);
    await env.AccessBridgeDB.prepare('INSERT OR IGNORE INTO credential_cache_config (principal_arn, last_cached_at) VALUES (?, 7)')
      .bind(ROLE)
      .run();

    await dao.storeCredential(ROLE, 'AKIAROLEEXAMPLE000000', 'roleSecret');

    const credential = await dao.getCredentialByPrincipalArn(ROLE);
    expect(credential).toMatchObject({ assumedBy: PARENT, accessKeyId: 'AKIAROLEEXAMPLE000000', secretAccessKey: 'roleSecret' });
    // INSERT OR REPLACE deleted the row first, which cascaded this away.
    const config = await env.AccessBridgeDB.prepare('SELECT last_cached_at FROM credential_cache_config WHERE principal_arn = ?')
      .bind(ROLE)
      .first<{ last_cached_at: number }>();
    expect(config?.last_cached_at).toBe(7);
  });

  it('keeps the stored keys when the relationship is stored again', async () => {
    const dao = new CredentialsDAO(env.AccessBridgeDB as never, [CREDENTIAL_KEY], 3);
    await dao.storeCredential(ROLE, 'AKIAROLEEXAMPLE000000', 'roleSecret', 'a-session-token');
    await dao.storeCredentialRelationship(ROLE, PARENT);

    await expect(dao.getCredentialByPrincipalArn(ROLE)).resolves.toMatchObject({
      assumedBy: PARENT,
      accessKeyId: 'AKIAROLEEXAMPLE000000',
      secretAccessKey: 'roleSecret',
      sessionToken: 'a-session-token',
    });
  });

  it('clears a stored session token when new keys carry none', async () => {
    const dao = new CredentialsDAO(env.AccessBridgeDB as never, [CREDENTIAL_KEY], 3);
    await dao.storeCredential(ROLE, 'AKIAROLEEXAMPLE000000', 'roleSecret', 'a-session-token');
    await dao.storeCredential(ROLE, 'AKIAROLEEXAMPLE000000', 'roleSecret');
    const credential = await dao.getCredentialByPrincipalArn(ROLE);
    expect(credential.sessionToken).toBeUndefined();
  });
});
