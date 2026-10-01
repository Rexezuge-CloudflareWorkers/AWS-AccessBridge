import { describe, expect, it } from 'vitest';
import { retentionCutoff } from '../../scripts/backup/retention';
import { isBackupArtifact, parseS3ListRow, shouldDeleteBackup } from '../../scripts/backup/s3-prune';

const CUTOFF = '2026-09-01';

describe('shouldDeleteBackup', () => {
  it('deletes an encrypted backup past the retention window', () => {
    expect(shouldDeleteBackup({ fileDate: '2026-08-01', fileName: 'access-bridge_prod_2026-08-01_04-15-00.sql.xz.enc' }, CUTOFF)).toBe(
      true,
    );
  });

  it('keeps a backup inside the retention window', () => {
    expect(shouldDeleteBackup({ fileDate: '2026-09-28', fileName: 'access-bridge_prod_2026-09-28_04-15-00.sql.xz.enc' }, CUTOFF)).toBe(
      false,
    );
  });

  it('keeps anything that is not a backup artifact, even when it is ancient', () => {
    expect(shouldDeleteBackup({ fileDate: '2020-01-01', fileName: 'README-do-not-delete.md' }, CUTOFF)).toBe(false);
    expect(shouldDeleteBackup({ fileDate: '2020-01-01', fileName: 'some-other-app.tar.gz' }, CUTOFF)).toBe(false);
  });

  it('treats a same-day object as still inside the window', () => {
    expect(shouldDeleteBackup({ fileDate: CUTOFF, fileName: 'access-bridge_prod_2026-09-01_04-15-00.sql.xz.enc' }, CUTOFF)).toBe(false);
  });
});

describe('isBackupArtifact', () => {
  it('accepts both the compressed plaintext and the encrypted form', () => {
    expect(isBackupArtifact('backup.sql.xz')).toBe(true);
    expect(isBackupArtifact('backup.sql.xz.enc')).toBe(true);
  });

  it('still accepts backups written before the switch to xz', () => {
    // Dropping `.gz` would strand every pre-switch object in the bucket
    // forever, since nothing else prunes the prefix.
    expect(isBackupArtifact('backup.sql.gz')).toBe(true);
    expect(isBackupArtifact('backup.sql.gz.enc')).toBe(true);
  });

  it('rejects near misses', () => {
    expect(isBackupArtifact('backup.sql')).toBe(false);
    expect(isBackupArtifact('backup.sql.xz.sig')).toBe(false);
    expect(isBackupArtifact('backup.sql.gz.sig')).toBe(false);
    expect(isBackupArtifact('')).toBe(false);
  });
});

describe('parseS3ListRow', () => {
  it('splits the date, time, size and key columns', () => {
    expect(parseS3ListRow('2026-08-01 04:15:00       1024 access-bridge_prod_2026-08-01_04-15-00.sql.xz.enc')).toEqual({
      fileDate: '2026-08-01',
      fileName: 'access-bridge_prod_2026-08-01_04-15-00.sql.xz.enc',
    });
  });

  it('ignores blank and truncated rows', () => {
    expect(parseS3ListRow('')).toBeUndefined();
    expect(parseS3ListRow('Total Objects: 3')).toBeUndefined();
  });
});

describe('retentionCutoff', () => {
  it('returns the ISO date N days before now', () => {
    expect(retentionCutoff(new Date('2026-10-01T04:15:00Z'), 30)).toBe('2026-09-01');
    expect(retentionCutoff(new Date('2026-10-01T04:15:00Z'), 1)).toBe('2026-09-30');
  });
});