import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The fork-staleness guard, `ensureMinimumConfigVersion`.
 *
 * This check existed but was inert: the template declared `$minimumVersion` as a
 * comment, so the function returned at its first branch and never compared
 * anything. That matters because a stale `WRANGLER_JSONC` repository variable is
 * the realistic failure mode — a fork's config outlives the template's binding
 * changes — and two of the bindings it can be missing are serious: an omitted
 * `INTERNAL_REQUEST_HMAC_SECRET` breaks every internal self-call, and an omitted
 * `ENVIRONMENT: "production"` leaves the `DEV_AUTH_EMAIL` auth bypass armed.
 *
 * Nothing tested this function, which is why nothing noticed it was a no-op.
 *
 * `CONFIG_PATH`/`TEMPLATE_PATH` are computed from `process.cwd()` at import time,
 * so each case runs in a throwaway directory with a fresh module registry.
 */
describe('ensureMinimumConfigVersion', () => {
  let workdir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workdir = mkdtempSync(path.join(tmpdir(), 'wrangler-config-'));
    mkdirSync(path.join(workdir, 'apps/api'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true });
    vi.resetModules();
  });

  function write(template: string, config: string): void {
    writeFileSync(path.join(workdir, 'apps/api/wrangler.template.jsonc'), template);
    writeFileSync(path.join(workdir, 'wrangler.jsonc'), config);
  }

  async function run(): Promise<void> {
    process.chdir(workdir);
    vi.resetModules();
    const { ensureMinimumConfigVersion } = await import('../../scripts/lib/wrangler-config/patches');
    ensureMinimumConfigVersion();
  }

  it('passes when the config version meets the minimum', async () => {
    write('{\n  "$minimumVersion": 200,\n  "$version": 250\n}\n', '{\n  "$version": 250\n}\n');
    await expect(run()).resolves.toBeUndefined();
  });

  it('passes when the versions are exactly equal', async () => {
    // The comparison is `<`, so an exactly-equal config must not fail — that
    // would lock out the common case of a config copied straight from the
    // template.
    write('{\n  "$minimumVersion": 250\n}\n', '{\n  "$version": 250\n}\n');
    await expect(run()).resolves.toBeUndefined();
  });

  it('fails when the config is older than the template requires', async () => {
    write('{\n  "$minimumVersion": 300\n}\n', '{\n  "$version": 250\n}\n');
    await expect(run()).rejects.toThrow(/below minimum template version \(300\)/);
  });

  it('fails when the config carries no version at all', async () => {
    // The realistic stale case: an older config that predates the field.
    write('{\n  "$minimumVersion": 300\n}\n', '{\n  "name": "aws-access-bridge"\n}\n');
    await expect(run()).rejects.toThrow(/wrangler\.jsonc version \(missing\)/);
  });

  it('names the fix, so the failure is actionable', async () => {
    // A deploy that dies with "version below minimum" and no next step is the
    // failure mode the function's own docstring says it exists to prevent.
    write('{\n  "$minimumVersion": 300\n}\n', '{\n  "$version": 100\n}\n');
    await expect(run()).rejects.toThrow(/Regenerate it from apps\/api\/wrangler\.template\.jsonc/);
  });

  it('stays inert when the template declares no minimum', async () => {
    // Preserved escape hatch: a template that has not opted in must not fail a
    // deploy, since `wrangler.jsonc` may legitimately carry no version.
    write('{\n  "name": "aws-access-bridge"\n}\n', '{\n  "name": "aws-access-bridge"\n}\n');
    await expect(run()).resolves.toBeUndefined();
  });

  it('still enforces when the minimum is set and the config version is not a number', async () => {
    // A string version is a malformed fork, not a pass.
    write('{\n  "$minimumVersion": 300\n}\n', '{\n  "$version": "250"\n}\n');
    await expect(run()).rejects.toThrow(/below minimum template version/);
  });

  it('the shipped template actually declares a minimum', async () => {
    // The guard above is only meaningful while the template opts in. This reads
    // the real file so the assertion cannot be satisfied by the test's own
    // fixtures — the regression being locked down is the template being
    // commented out again.
    const { readFileSync } = await import('node:fs');
    const { parse } = await import('jsonc-parser');
    const templatePath = path.join(originalCwd, 'apps/api/wrangler.template.jsonc');
    const template = parse(readFileSync(templatePath, 'utf8')) as { $minimumVersion?: unknown };

    expect(typeof template.$minimumVersion).toBe('number');
  });
});