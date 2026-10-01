#!/usr/bin/env tsx

/**
 * Materializes `wrangler.jsonc` for a deploy.
 *
 * Runs first in `continuous-deployment.yml` and again in `backup-d1.yml`, so
 * both the deploy and the backup target the same database. All the logic lives
 * in `lib/wrangler-config/`; this file is only the ordered sequence.
 */

import { applyTopLevelPatch, applyVarsPatch, ensureMinimumConfigVersion, prepareConfigFile } from '../lib/wrangler-config/patches';
import { provisionWranglerResources } from '../lib/wrangler-config/resources';

// Order matters: the file must exist before it can be patched, the version
// check must see the template's floor, and resources are provisioned last so
// they see the patched values.
prepareConfigFile();
ensureMinimumConfigVersion();
applyTopLevelPatch();
applyVarsPatch();
provisionWranglerResources();
console.log('Wrangler configuration is ready.');
