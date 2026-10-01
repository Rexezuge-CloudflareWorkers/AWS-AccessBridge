import { describe, expect, it } from 'vitest';
import { evaluateConfig } from '../../scripts/backup/destination-config';

const CLOUDFLARE = { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'account-id' } as const;
const KEY = { BACKUP_ENCRYPTION_KEY: 'passphrase' } as const;
const S3 = { S3_ACCESS_KEY_ID: 'key-id', S3_SECRET_ACCESS_KEY: 'secret', S3_BUCKET: 'backups' } as const;
const WEBDAV = { WEBDAV_URL: 'https://dav.example.com/', WEBDAV_USER: 'user', WEBDAV_PASSWORD: 'pw' } as const;

describe('evaluateConfig', () => {
  it('treats a fully unconfigured repository as a valid no-backup state', () => {
    const config = evaluateConfig({});

    expect(config).toMatchObject({ anyDestination: false, s3: false, webdav: false });
    expect(config.errors).toEqual([]);
  });

  it('fails closed when a destination is configured without an encryption key', () => {
    const config = evaluateConfig({ ...CLOUDFLARE, ...S3 });

    expect(config.s3).toBe(true);
    expect(config.encryption).toBe(false);
    expect(config.errors).toEqual([expect.stringContaining('BACKUP_ENCRYPTION_KEY is required')]);
  });

  it('fails closed when a destination is configured without Cloudflare credentials', () => {
    const config = evaluateConfig({ ...KEY, ...WEBDAV });

    expect(config.webdav).toBe(true);
    expect(config.cloudflare).toBe(false);
    expect(config.errors).toEqual([expect.stringContaining('CLOUDFLARE_API_TOKEN')]);
  });

  it('reports both missing prerequisites at once', () => {
    expect(evaluateConfig({ ...S3, ...WEBDAV }).errors).toHaveLength(2);
  });

  it('accepts a complete configuration', () => {
    const config = evaluateConfig({ ...CLOUDFLARE, ...KEY, ...S3, ...WEBDAV });

    expect(config).toMatchObject({ cloudflare: true, encryption: true, s3: true, webdav: true });
    expect(config.errors).toEqual([]);
  });

  it('enables S3 without S3_REGION, which R2 and MinIO cannot supply meaningfully', () => {
    expect(evaluateConfig({ ...CLOUDFLARE, ...KEY, ...S3 }).s3).toBe(true);
  });

  it('ignores whitespace-only secrets', () => {
    const config = evaluateConfig({ ...CLOUDFLARE, BACKUP_ENCRYPTION_KEY: '   ', ...S3 });

    expect(config.encryption).toBe(false);
    expect(config.errors).toHaveLength(1);
  });

  it('does not enable a destination from a partial secret set', () => {
    expect(evaluateConfig({ ...CLOUDFLARE, ...KEY, S3_ACCESS_KEY_ID: 'key-id' }).s3).toBe(false);
    expect(evaluateConfig({ ...CLOUDFLARE, ...KEY, WEBDAV_URL: 'https://dav.example.com/' }).webdav).toBe(false);
  });
});
