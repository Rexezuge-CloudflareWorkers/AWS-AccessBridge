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
 * Compression is xz at preset 6, chosen for ratio over speed: this runs once a
 * day against a dump that is mostly SQL text and JSON blobs, and LZMA typically
 * beats gzip by 20-30% there. `-T0` uses every available thread, which matters
 * because xz is markedly slower than gzip and the job is wall-clock bound.
 *
 * Emits the resulting file name as the `file` step output.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fail, setOutput } from '../lib/github-actions';
import { backupFileName } from './naming';

const SOURCE_FILE = 'backup.sql';

/**
 * AES-256-CBC with a random salt and a deliberately slow KDF.
 */
const CIPHER_ARGS = ['enc', '-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '100000'];

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

if (!process.env.BACKUP_ENCRYPTION_KEY) {
  fail('BACKUP_ENCRYPTION_KEY is not set. Refusing to export an unencrypted database.');
}

if (!existsSync(SOURCE_FILE)) {
  fail(`Expected ${SOURCE_FILE} from the export step, but it does not exist.`);
}

const file = backupFileName(new Date());

// Unlike gzip, xz leaves its input in place, so the plaintext SQL has to be
// removed explicitly here or it survives into the artifact store.
run('xz', ['-T0', '-6', SOURCE_FILE]);
run('openssl', [...CIPHER_ARGS, '-in', `${SOURCE_FILE}.xz`, '-out', file, '-pass', 'env:BACKUP_ENCRYPTION_KEY']);

rmSync(SOURCE_FILE, { force: true });
rmSync(`${SOURCE_FILE}.xz`, { force: true });

console.log(`✅ Backup encrypted: ${file}`);
setOutput('file', file);
