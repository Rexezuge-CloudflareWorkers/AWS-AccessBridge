import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'jsonc-parser';

/**
 * The template-coverage guard, `ensureConfigCoversTemplate`.
 *
 * This check replaces a `$version`/`$minimumVersion` integer guard, and the
 * regression that guard introduced is the reason its replacement is written the
 * way it is. The template carried both keys as comments; the original workflow
 * read them with `grep`, which matches commented text, so the guard worked. The
 * port to `jsonc-parser` discarded the comments, which turned an inert template
 * into a fatal one: `prepareConfigFile` falls back to copying the template when
 * `WRANGLER_JSONC` is unset, the copy carries no `$version`, and
 * `ensureMinimumConfigVersion` refused the very file it had just written. The
 * nightly backup died on it at 04:15 UTC.
 *
 * Comparing declared keys instead of a version integer is immune to that whole
 * class: a config materialized from the template is byte-identical to it, so it
 * always passes, and an override that has fallen behind still cannot.
 *
 * `CONFIG_PATH`/`TEMPLATE_PATH` are computed from `process.cwd()` at import time,
 * so each case runs in a throwaway directory with a fresh module registry.
 */
/**
Relative to the repo root, and the only place the shipped template lives.
*/
const SHIPPED_TEMPLATE = 'apps/api/wrangler.template.jsonc';

describe('ensureConfigCoversTemplate', () => {
  let workdir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workdir = mkdtempSync(path.join(tmpdir(), 'wrangler-coverage-'));
    mkdirSync(path.join(workdir, 'apps/api'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true });
    delete process.env.WRANGLER_VARS_PATCH_JSON;
    vi.resetModules();
  });

  /**
  The real shipped template, so a case exercises the file that actually deploys.
  */
  function writeRealTemplate(): void {
    copyFileSync(path.join(originalCwd, SHIPPED_TEMPLATE), path.join(workdir, SHIPPED_TEMPLATE));
  }

  function write(template: string, config: string): void {
    writeFileSync(path.join(workdir, 'apps/api/wrangler.template.jsonc'), template);
    writeFileSync(path.join(workdir, 'wrangler.jsonc'), config);
  }

  /**
   * A config exercising every field the guard reads, at the smallest useful size.
   *
   * Kept as an object rather than JSON text so a case can drop one key and leave
   * the rest byte-for-byte intact — regex surgery on JSON silently produces a
   * config that fails for the wrong reason, which is how a guard test ends up
   * asserting nothing.
   */
  const FULL_CONFIG = {
    name: 'aws-access-bridge',
    d1_databases: [{ binding: 'AccessBridgeDB', database_id: 'x' }],
    kv_namespaces: [{ binding: 'AccessBridgeKV', id: 'y' }],
    secrets_store_secrets: [
      { binding: 'CREDENTIAL_ENCRYPTION_KEY_SECRET', store_id: 'z' },
      { binding: 'CREDENTIAL_CACHE_ENCRYPTION_KEY_SECRET', store_id: 'z' },
      { binding: 'INTERNAL_REQUEST_HMAC_SECRET', store_id: 'z' },
    ],
    durable_objects: { bindings: [{ name: 'CRON_TASKS', class_name: 'CronTasksWorker' }] },
    services: [{ binding: 'SELF', service: 'aws-access-bridge' }],
    vars: { ENVIRONMENT: 'production', DEMO_MODE: 'false' },
  };

  /**
   * Every field the guard reads, each optional at the top level only.
   *
   * Hand-written rather than `Partial<typeof FULL_CONFIG>`, which is shallow and
   * would still reject `config.secrets_store_secrets.filter(...)` and a `vars`
   * literal missing a key — i.e. exactly the edits a case needs to make.
   */
  type ConfigShape = {
    name?: string;
    d1_databases?: Array<{ binding: string; database_id: string }>;
    kv_namespaces?: Array<{ binding: string; id: string }>;
    secrets_store_secrets?: Array<{ binding: string; store_id: string }>;
    durable_objects?: { bindings: Array<{ name: string; class_name: string }> };
    services?: Array<{ binding: string; service: string }>;
    vars?: Record<string, string>;
  };

  const TEMPLATE = JSON.stringify(FULL_CONFIG, null, 2);

  /**
  Writes the fixture template with `mutate`'s config as `wrangler.jsonc`.
  */
  function writeWith(mutate: (config: ConfigShape) => ConfigShape): void {
    write(TEMPLATE, JSON.stringify(mutate(structuredClone(FULL_CONFIG)), null, 2));
  }

  async function run(): Promise<void> {
    process.chdir(workdir);
    vi.resetModules();
    const { ensureConfigCoversTemplate } = await import('../../scripts/lib/wrangler-config/template-coverage');
    ensureConfigCoversTemplate();
  }

  /**
   * The guard in its real position: after both patches, before provisioning.
   *
   * `provisionWranglerResources` is deliberately not called — it shells out to
   * wrangler against the live Cloudflare API, which a unit test must not do, and
   * the ordering it would prove (coverage before provisioning) is asserted by the
   * entrypoint's own sequence instead.
   */
  async function runMaterializeSequence(): Promise<void> {
    process.chdir(workdir);
    vi.resetModules();
    const { applyTopLevelPatch, applyVarsPatch, prepareConfigFile } = await import('../../scripts/lib/wrangler-config/patches');
    const { ensureConfigCoversTemplate } = await import('../../scripts/lib/wrangler-config/template-coverage');

    prepareConfigFile();
    applyTopLevelPatch();
    applyVarsPatch();
    ensureConfigCoversTemplate();
  }

  it('passes when the config carries every binding and var', async () => {
    write(TEMPLATE, TEMPLATE);
    await expect(run()).resolves.toBeUndefined();
  });

  it('passes for the shipped template copied verbatim', async () => {
    // The case that broke CI: `prepareConfigFile` copies the template when
    // WRANGLER_JSONC is unset, and the guard must accept what it just wrote.
    // Run through the real ordered sequence rather than the guard alone, since
    // the ordering is part of what was wrong — a guard tested in isolation
    // cannot see that it ran before the patches or after provisioning.
    writeRealTemplate();
    await expect(runMaterializeSequence()).resolves.toBeUndefined();
  });

  it('accepts a var supplied by the vars patch, because coverage runs after it', async () => {
    // The documented route for a fork that does not carry the whole file. If the
    // check moved ahead of `applyVarsPatch`, this legitimate config would fail.
    // The fixture carries two vars, so dropping one is a real gap the patch has to
    // close rather than a config that was never incomplete.
    writeWith((config) => ({ ...config, vars: { DEMO_MODE: 'false' } }));
    process.env.WRANGLER_VARS_PATCH_JSON = JSON.stringify({ ENVIRONMENT: 'production' });

    await expect(runMaterializeSequence()).resolves.toBeUndefined();
  });

  it('fails when a D1 binding is missing', async () => {
    // No binding the worker reads means every request fails on the missing env.
    writeWith((config) => ({ ...config, d1_databases: [] }));
    await expect(run()).rejects.toThrow(/d1_databases\[\]\.binding: AccessBridgeDB/);
  });

  it('fails when the internal HMAC secret binding is missing', async () => {
    // The binding whose absence breaks every internal self-call.
    writeWith((config) => {
      config.secrets_store_secrets = (config.secrets_store_secrets ?? []).filter(
        (secret) => secret.binding !== 'INTERNAL_REQUEST_HMAC_SECRET',
      );
      return config;
    });
    await expect(run()).rejects.toThrow(/secrets_store_secrets\[\]\.binding: INTERNAL_REQUEST_HMAC_SECRET/);
  });

  it('fails when the Durable Object binding is missing', async () => {
    // Provisioning injects missing KV bindings but nothing heals this one, and a
    // worker without `CRON_TASKS` has no scheduled pipeline at all.
    writeWith((config) => ({ ...config, durable_objects: undefined }));
    await expect(run()).rejects.toThrow(/durable_objects\.bindings\[\]\.name: CRON_TASKS/);
  });

  it('fails when the SELF service binding is missing', async () => {
    writeWith((config) => ({ ...config, services: [] }));
    await expect(run()).rejects.toThrow(/services\[\]\.binding: SELF/);
  });

  it('fails when a var is missing, and points at the patch variable', async () => {
    // `ENVIRONMENT: "production"` is what arms the DEV_AUTH_EMAIL guard, so its
    // absence is a production auth bypass rather than a config nit.
    writeWith((config) => ({ ...config, vars: { DEMO_MODE: 'false' } }));
    await expect(run()).rejects.toThrow(/vars: ENVIRONMENT[\s\S]*WRANGLER_VARS_PATCH_JSON/);
  });

  it('does not require a KV binding, because provisioning injects it', async () => {
    // `ensureRequiredKvBindings` adds any of DEFAULT_KV_NAMESPACE_NAMES a config
    // omits, so failing here would reject a config about to be completed.
    writeWith((config) => ({ ...config, kv_namespaces: [] }));
    await expect(run()).resolves.toBeUndefined();
  });

  it('compares presence, not values', async () => {
    // A deployment fills these with its own real Zero Trust values through
    // WRANGLER_VARS_PATCH_JSON; an equality check would fail every override.
    writeWith((config) => ({ ...config, vars: { ...config.vars, ENVIRONMENT: 'staging' } }));
    await expect(run()).resolves.toBeUndefined();
  });

  it('reports every gap at once rather than the first', async () => {
    // One run must name the whole resync, not make the reader fix it one deploy
    // at a time.
    write(TEMPLATE, '{ "name": "aws-access-bridge" }');
    await expect(run()).rejects.toThrow(/AccessBridgeDB[\s\S]*CRON_TASKS[\s\S]*ENVIRONMENT/);
  });

  it('names the fix, so the failure is actionable', async () => {
    write(TEMPLATE, '{ "name": "aws-access-bridge" }');
    await expect(run()).rejects.toThrow(/Regenerate it from apps\/api\/wrangler\.template\.jsonc/);
  });

  it('the shipped template declares no custom version keys', async () => {
    // Reads the real file. `$version`/`$minimumVersion` are not in wrangler's
    // schema — it flags them and suggests an upgrade — so they stay commented,
    // and the guard this replaced read them with jsonc-parser, which drops
    // comments. Un-commenting them would revive a dead mechanism.
    const template = parse(readFileSync(path.join(originalCwd, SHIPPED_TEMPLATE), 'utf8')) as {
      $version?: unknown;
      $minimumVersion?: unknown;
    };

    expect(template.$version).toBeUndefined();
    expect(template.$minimumVersion).toBeUndefined();
  });

  it('the shipped template declares the bindings the guard requires', async () => {
    // The guard is only meaningful while the template still declares the things
    // it compares. An empty `services` list would silently stop checking SELF.
    const template = parse(readFileSync(path.join(originalCwd, SHIPPED_TEMPLATE), 'utf8')) as {
      services?: unknown;
      durable_objects?: unknown;
    };
    const services = template.services as Array<{ binding?: string }> | undefined;

    expect(services?.map((service) => service.binding)).toContain('SELF');
    expect(template.durable_objects).toBeDefined();
  });
});
