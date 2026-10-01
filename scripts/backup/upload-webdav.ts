#!/usr/bin/env tsx

/**
 * Uploads the encrypted backup to WebDAV via rclone and prunes expired backups.
 *
 * Configures the `webdav` remote from environment variables and writes the
 * obscured password to `~/.config/rclone/rclone.conf`. rclone must already be on
 * PATH — the workflow installs it with the pinned `AnimMouse/setup-rclone`
 * action.
 */

import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { fail } from './github-output';
import { requireRetentionDays } from './retention';

const DEFAULT_BASE_PATH = 'aws-access-bridge';
const REMOTE = 'webdav';

function rclone(args: string[]): string {
  return execFileSync('rclone', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/** Where backups land on the remote, e.g. `webdav:aws-access-bridge/production`. */
export function remoteTargetDir(basePath: string): string {
  return `${REMOTE}:${basePath || DEFAULT_BASE_PATH}/production`;
}

function writeRcloneConfig(url: string, vendor: string, user: string, password: string): void {
  const configDir = join(homedir(), '.config', 'rclone');
  mkdirSync(configDir, { recursive: true });

  // rclone stores the password obscured, not encrypted — reversible from the
  // config file, which is why it lives outside the repository and the artifact.
  const obscured = rclone(['obscure', password]);

  writeFileSync(
    join(configDir, 'rclone.conf'),
    [`[${REMOTE}]`, 'type = webdav', `url = ${url}`, `vendor = ${vendor}`, `user = ${user}`, `pass = ${obscured.trim()}`, ''].join('\n'),
  );
}

const isMain = process.argv[1]?.endsWith('upload-webdav.ts') ?? false;
if (isMain) {
  const { WEBDAV_URL: url, WEBDAV_USER: user, WEBDAV_PASSWORD: password } = process.env;
  const file = process.env.BACKUP_FILE;
  if (!url || !user || !password || !file) {
    fail('BACKUP_FILE, WEBDAV_URL, WEBDAV_USER and WEBDAV_PASSWORD must all be set to upload a backup.');
  }

  // Validate before touching the remote: a bad retention window should fail the
  // run without having already written to it.
  const retentionDays = requireRetentionDays();

  writeRcloneConfig(url, process.env.WEBDAV_VENDOR || 'other', user, password);

  const basePath = process.env.WEBDAV_BASE_PATH || DEFAULT_BASE_PATH;
  const targetDir = remoteTargetDir(basePath);

  // The base and production directories may not exist yet on a fresh WebDAV host.
  rclone(['mkdir', `${REMOTE}:${basePath}`]);
  rclone(['mkdir', targetDir]);

  rclone(['copyto', file, `${targetDir}/${file}`]);
  console.log(`✅ Backup uploaded to WebDAV: ${targetDir}/${file}`);

  rclone(['delete', `${targetDir}/`, '-v', '--min-age', `${retentionDays}d`]);
  console.log('✅ Cleanup completed');
}
