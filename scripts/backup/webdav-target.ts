/**
 * WebDAV target paths, shared by the upload script and its tests.
 */

const DEFAULT_BASE_PATH = 'aws-access-bridge';
const REMOTE = 'webdav';

/**
 * Where backups land on the remote, e.g. `webdav:aws-access-bridge/production`.
 */
export function remoteTargetDir(basePath: string): string {
  return `${REMOTE}:${basePath || DEFAULT_BASE_PATH}/production`;
}
