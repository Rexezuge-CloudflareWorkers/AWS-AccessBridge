/**
 * WebDAV target paths, shared by the upload script and its tests.
 */

/**
 * The base path when the operator sets none.
 *
 * Declared **here** and exported rather than repeated in `upload-webdav.ts`, which is
 * where this was declared twice. Two declarations of one default are free to disagree,
 * and the disagreement is invisible until a backup lands somewhere nobody is looking —
 * which is the one property a backup target must not have.
 */
export const DEFAULT_BASE_PATH = 'aws-access-bridge';

/**
 * The rclone remote name `upload-webdav.ts` configures from the environment.
 */
export const REMOTE = 'webdav';

/**
 * Where backups land on the remote, e.g. `webdav:aws-access-bridge/production`.
 */
export function remoteTargetDir(basePath: string): string {
  return `${REMOTE}:${basePath || DEFAULT_BASE_PATH}/production`;
}