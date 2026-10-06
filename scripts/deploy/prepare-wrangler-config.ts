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
import { applyTopLevelPatch, applyVarsPatch, ensureMinimumConfigVersion, prepareConfigFile } from '../lib/wrangler-config/patches';
import { provisionWranglerResources } from '../lib/wrangler-config/resources';

// Order matters: the file must exist before it can be patched, the version
// check must see the template's floor, and resources are provisioned last so
// they see the patched values.
prepareConfigFile();
ensureMinimumConfigVersion();
applyTopLevelPatch();
applyVarsPatch();
const created = provisionWranglerResources();

// Published as a step output rather than only printed. `export-d1` in the backup
// workflow needs to know whether the D1 database *existed* or was created moments
// ago: a fresh one holds no user data, and uploading that empty dump every night is a
// false sense of safety. The alternative — re-reading the placeholder id out of
// `wrangler.jsonc` — is unreachable, because `provisionWranglerResources` patches the
// placeholder away before the reader ever runs.
setOutput('created', created.join(','));
console.log('Wrangler configuration is ready.');
