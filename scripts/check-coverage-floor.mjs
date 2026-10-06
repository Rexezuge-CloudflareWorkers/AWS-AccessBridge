#!/usr/bin/env node
/**
 * Per-file coverage floors for the files whose *regression* would matter most.
 *
 * An aggregate threshold can be met while a single security-critical file rots:
 * `MiddlewareHandlers` sat at 61.5% branch coverage — the whole auth chain —
 * while the project total looked healthy enough to raise the bar past. This gate
 * is the complement to `vitest.config.mts`'s aggregate: it pins the files whose
 * coverage is load-bearing, so a new file cannot buy aggregate headroom by letting
 * one of these decay.
 *
 * Floors are set a little under each file's measured coverage, for the same reason
 * the aggregate ones are: ordinary churn should not fail the build, a real decay
 * should.
 *
 * Reads `coverage/lcov.info`, so run `pnpm run test:coverage` first. Exits non-zero
 * and prints a table of the breaches.
 */
import { existsSync, readFileSync } from 'node:fs';

/**
Line/branch percentage floors, keyed by path suffix so the check survives moves.
*/
const FLOORS = [
  // --- Authentication and the internal trust boundary -------------------------
  { branch: 60, file: 'apps/api/src/middleware/MiddlewareHandlers.ts', line: 80 },
  { branch: 50, file: 'apps/api/src/middleware/HMACHandler.ts', line: 90 },
  { branch: 50, file: 'packages/backend-services/src/auth/AccessAuthService.ts', line: 85 },
  { branch: 50, file: 'packages/backend-services/src/auth/TokenService.ts', line: 80 },
  { branch: 45, file: 'packages/backend-data/src/crypto/hmac.ts', line: 90 },
  { branch: 60, file: 'packages/backend-services/src/identity/UserIdentityService.ts', line: 85 },
  { branch: 50, file: 'packages/backend-services/src/auth/ReplayGuard.ts', line: 85 },

  // --- Request validation and the error taxonomy -------------------------------
  { branch: 60, file: 'packages/shared/src/schema/input.ts', line: 90 },
  { branch: 50, file: 'packages/shared/src/schema/common.ts', line: 85 },
  { branch: 50, file: 'packages/shared/src/utils/RequestOriginUtil.ts', line: 80 },

  // --- Credential encryption and chain resolution ------------------------------
  { branch: 60, file: 'packages/backend-data/src/crypto/aes-gcm.ts', line: 90 },
  { branch: 45, file: 'packages/backend-services/src/credential/CredentialChainWalker.ts', line: 80 },
  { branch: 45, file: 'packages/backend-services/src/credential/CredentialChainService.ts', line: 80 },
  { branch: 40, file: 'packages/backend-services/src/aws/assume-role/AssumeRoleService.ts', line: 75 },

  // --- Data integrity ----------------------------------------------------------
  { branch: 45, file: 'packages/backend-data/src/utils/D1Utils.ts', line: 85 },
  { branch: 40, file: 'packages/backend-data/src/dao/UserAccessTokenDAO.ts', line: 75 },
  { branch: 35, file: 'packages/backend-data/src/dao/CredentialsDAO.ts', line: 75 },
  { branch: 35, file: 'packages/backend-data/src/dao/BackgroundTaskRunDAO.ts', line: 70 },

  // --- Background pipeline -----------------------------------------------------
  { branch: 45, file: 'apps/background/src/CronTasksWorker.ts', line: 75 },
  { branch: 45, file: 'apps/background/src/scheduled/AbstractCollectionTask.ts', line: 75 },
  { branch: 40, file: 'apps/background/src/scheduled/ResourceInventoryCollectionTask.ts', line: 75 },

  // --- Routing -----------------------------------------------------------------
  { branch: 30, file: 'apps/api/src/workers/AccessBridgeWorker.ts', line: 80 },

  // --- Logging (a leak here is silent) -----------------------------------------
  { branch: 80, file: 'packages/shared/src/utils/Logger.ts', line: 90 },
];

const LCOV = 'coverage/lcov.info';

if (!existsSync(LCOV)) {
  console.error(`Missing ${LCOV}. Run \`pnpm run test:coverage\` first — this gate reads the report it writes.`);
  process.exit(1);
}

/**
@returns {{line: number, branch: number, found: boolean}}
*/
function coverageFor(lcov, suffix) {
  const result = { branch: 100, found: false, line: 100 };
  for (const block of lcov.split('end_of_record')) {
    const source = /^SF:(.+)$/m.exec(block)?.[1];
    if (!source || !source.endsWith(suffix)) continue;

    let covered = 0;
    let total = 0;
    let branchesCovered = 0;
    let branchesTotal = 0;
    // Index 1 is the hit count; the line number is not needed here.
    for (const record of block.matchAll(/^DA:\d+,(\d+)/gm)) {
      total += 1;
      if (record[1] !== '0') covered += 1;
    }
    for (const match of block.matchAll(/^BRDA:(\d+),(\d+),(\d+),(\d+|-)/gm)) {
      branchesTotal += 1;
      if (match[4] !== '0' && match[4] !== '-') branchesCovered += 1;
    }
    result.found = true;
    result.line = total === 0 ? 100 : Math.floor((covered / total) * 10_000) / 100;
    result.branch = branchesTotal === 0 ? 100 : Math.floor((branchesCovered / branchesTotal) * 10_000) / 100;
  }
  return result;
}

const lcov = readFileSync(LCOV, 'utf8');
const breaches = [];
const missing = [];

for (const floor of FLOORS) {
  const actual = coverageFor(lcov, floor.file);
  if (!actual.found) {
    // A floor for a file that is no longer covered-eligible (renamed, excluded from
    // coverage) is stale config, not a regression — reported, never a hard failure,
    // so removing a file does not require a matching edit here to unblock CI.
    missing.push(floor.file);
    continue;
  }
  const lineShortfall = actual.line < floor.line;
  const branchShortfall = actual.branch < floor.branch;
  if (lineShortfall || branchShortfall) {
    breaches.push({ ...floor, actual });
  }
}

if (missing.length > 0) {
  console.warn(`Note: ${missing.length} coverage floor(s) name a file absent from the report (renamed, or no longer coverage-eligible):`);
  for (const file of missing) console.warn(`  ${file}`);
  console.warn('');
}

if (breaches.length > 0) {
  console.error('Per-file coverage floors breached:\n');
  console.error('  line%  branch%   floor(line/branch)  file');
  for (const breach of breaches) {
    console.error(
      `  ${String(breach.actual.line).padStart(5)}  ${String(breach.actual.branch).padStart(6)}   ` +
        `${String(breach.line).padStart(5)}/${String(breach.branch).padStart(3)}          ${breach.file}`,
    );
  }
  console.error('\nThese files carry the auth boundary, credential encryption, or data integrity.');
  process.exit(1);
}

console.log(`Per-file coverage floors met (${FLOORS.length} files checked).`);