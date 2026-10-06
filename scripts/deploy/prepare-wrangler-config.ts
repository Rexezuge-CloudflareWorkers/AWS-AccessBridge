#!/usr/bin/env tsx

/**
 * Materializes `wrangler.jsonc` for a deploy.
 *
 * Runs first in `continuous-deployment.yml` and again in `backup-d1.yml`, so
 * both the deploy and the backup target the same database. All the logic lives
 * in `lib/wrangler-config/`; this file is only the ordered sequence — plus the
 * one thing that is not a call.
 */

import { setOutput } from '../lib/github-actions';
import { applyTopLevelPatch, applyVarsPatch, prepareConfigFile } from '../lib/wrangler-config/patches';
import { provisionWranglerResources } from '../lib/wrangler-config/resources';
import { ensureConfigCoversTemplate } from '../lib/wrangler-config/template-coverage';

// Order matters: the file must exist before it can be patched, and coverage is
// checked after both patches so a var supplied by `WRANGLER_VARS_PATCH_JSON`
// counts the same as one carried in the file. Resources are provisioned last so
// they see the patched values — and after the check, so a config that cannot
// deploy never creates a D1 database, KV namespace, or Secrets Store on the way
// to finding out.
prepareConfigFile();
applyTopLevelPatch();
applyVarsPatch();
ensureConfigCoversTemplate();
const created = provisionWranglerResources();

// Published as a step output rather than only printed. `export-d1` in the backup
// workflow needs to know whether the D1 database *existed* or was created moments
// ago: a fresh one holds no user data, and uploading that empty dump every night is a
// false sense of safety. The alternative — re-reading the placeholder id out of
// `wrangler.jsonc` — is unreachable, because `provisionWranglerResources` patches the
// placeholder away before the reader ever runs.
setOutput('created', created.join(','));
console.log('Wrangler configuration is ready.');
