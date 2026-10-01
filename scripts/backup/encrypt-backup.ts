#!/usr/bin/env tsx

/**
 * Compresses and encrypts the exported D1 dump.
 *
 * Fail-closed: without `BACKUP_ENCRYPTION_KEY` the script refuses to run and
 * deletes nothing, so an unencrypted dump can never reach the artifact store
 * that the upload jobs read from.
 *
 * The passphrase is read from the environment rather than passed as an argument,
 * because command-line arguments are visible to any process on the runner via
 * `ps`. openssl's `env:` password source keeps it out of both the argv and the
 * shell history.
 *
 * Emits the resulting file name as the `file` step output.
 */

import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';

import { fail, setOutput } from './github-output';

const SOURCE_FILE = 'backup.sql';

/** AES-256-CBC with a random salt and a deliberately slow KDF. */
const CIPHER_ARGS = ['enc', '-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '100000'];

/** `2026-10-01_04-15-00` — sortable, filename-safe, and UTC. */
export function backupStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replaceAll(':', '-')}`;
}

export function backupFileName(date: Date): string {
  return `access-bridge_prod_${backupStamp(date)}.sql.gz.enc`;
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

const isMain = process.argv[1]?.endsWith('encrypt-backup.ts') ?? false;
if (isMain) {
  if (!process.env.BACKUP_ENCRYPTION_KEY) {
    fail('BACKUP_ENCRYPTION_KEY is not set. Refusing to export an unencrypted database.');
  }

  if (!existsSync(SOURCE_FILE)) {
    fail(`Expected ${SOURCE_FILE} from the export step, but it does not exist.`);
  }

  const file = backupFileName(new Date());

  run('gzip', [SOURCE_FILE]);
  run('openssl', [...CIPHER_ARGS, '-in', `${SOURCE_FILE}.gz`, '-out', file, '-pass', 'env:BACKUP_ENCRYPTION_KEY']);

  // gzip already unlinked the plaintext SQL; make the intent explicit so no
  // unencrypted copy survives into the artifact store.
  rmSync(SOURCE_FILE, { force: true });
  rmSync(`${SOURCE_FILE}.gz`, { force: true });

  console.log(`✅ Backup encrypted: ${file}`);
  setOutput('file', file);
}
