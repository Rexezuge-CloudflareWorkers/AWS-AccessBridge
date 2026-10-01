/**
 * Minimal GitHub Actions step helpers shared by the backup scripts.
 *
 * The scripts deliberately avoid `@actions/*` dependencies so they stay
 * runnable with plain `tsx` from a local shell, which is how they are tested.
 */

import { appendFileSync } from 'fs';

/** Append `name=value` to the step's output file. No-op outside Actions. */
export function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  appendFileSync(outputFile, `${name}=${value}\n`);
}

/** Emit a workflow-command annotation so the failure is visible in the run log. */
export function logError(message: string): void {
  process.stderr.write(`::error::${message}\n`);
}

/**
 * Report a fatal error and exit non-zero.
 *
 * The annotation is written before exiting so the reason survives in the run log.
 */
export function fail(message: string): never {
  logError(message);
  process.exit(1);
}
