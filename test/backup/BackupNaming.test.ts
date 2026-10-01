import { describe, expect, it } from 'vitest';
import { backupFileName, backupStamp } from '../../scripts/backup/encrypt-backup';
import { remoteTargetDir } from '../../scripts/backup/upload-webdav';

describe('backupStamp', () => {
  it('formats the UTC timestamp for a filename', () => {
    expect(backupStamp(new Date('2026-10-01T04:15:09Z'))).toBe('2026-10-01_04-15-09');
  });

  it('produces lexicographically sortable names', () => {
    const earlier = backupFileName(new Date('2026-09-28T04:15:00Z'));
    const later = backupFileName(new Date('2026-10-01T04:15:00Z'));

    expect(earlier < later).toBe(true);
    expect(later).toMatch(/^access-bridge_prod_2026-10-01_04-15-00\.sql\.gz\.enc$/);
  });
});

describe('remoteTargetDir', () => {
  it('nests backups under a production directory on the remote', () => {
    expect(remoteTargetDir('aws-access-bridge')).toBe('webdav:aws-access-bridge/production');
  });

  it('honours a custom base path', () => {
    expect(remoteTargetDir('team/backups')).toBe('webdav:team/backups/production');
  });
});
