import { describe, expect, it } from 'vitest';
import { isEmptySecretsStoreListing, parseWranglerTableRows } from '../../scripts/lib/wrangler-table';

/**
 * Captured from `wrangler secrets-store secret list <store-id> --remote`
 * (wrangler 4.140.0).
 *
 * The frame is `cli-table3` output: cells are joined by U+2502 and padded by
 * exactly one space, so the columns are *not* space-aligned. `Comment` is empty
 * on both rows, which is the shape that shifts columns for a naive parser.
 */
const SECRET_LIST_OUTPUT = [
  '\u{1F510} Listing secrets... (store-id: 0f1e2d3c4b5a69788796a5b4c3d2e1f0, page: 1, per-page: 10)',
  '┌────────────────────────────────┬──────────────────────────────────┬─────────┬─────────┬─────────┬───────────────────────┬───────────────────────┐',
  '│ Name                           │ ID                               │ Comment │ Scopes  │ Status  │ Created               │ Modified              │',
  '├────────────────────────────────┼──────────────────────────────────┼─────────┼─────────┼─────────┼───────────────────────┼───────────────────────┤',
  '│ aws-access-bridge-aes-encryption-key   │ 0f1e2d3c4b5a69788796a5b4c3d2e1f0 │         │ workers │ active  │ 9/29/2026, 1:00:00 AM │ 9/29/2026, 1:00:00 AM │',
  '│ aws-access-bridge-aes-encryption-key-2 │ 1a2b3c4d5e6f708192a3b4c5d6e7f809 │         │ workers │ active  │ 9/29/2026, 1:05:00 AM │ 9/29/2026, 1:05:00 AM │',
  '└────────────────────────────────┴──────────────────────────────────┴─────────┴─────────┴─────────┴───────────────────────┴───────────────────────┘',
].join('\n');

/** A store holding only the `-2` variant, to pin down exact-name matching. */
const PREFIX_ONLY_OUTPUT = [
  '┌────────────────────────────────┬──────────────────────────────────┬─────────┬─────────┬─────────┬───────────────────────┬───────────────────────┐',
  '│ Name                           │ ID                               │ Comment │ Scopes  │ Status  │ Created               │ Modified              │',
  '├────────────────────────────────┼──────────────────────────────────┼─────────┼─────────┼─────────┼───────────────────────┼───────────────────────┤',
  '│ aws-access-bridge-aes-encryption-key-2 │ 1a2b3c4d5e6f708192a3b4c5d6e7f809 │         │ workers │ active  │ 9/29/2026, 1:05:00 AM │ 9/29/2026, 1:05:00 AM │',
  '└────────────────────────────────┴──────────────────────────────────┴─────────┴─────────┴─────────┴───────────────────────┴───────────────────────┘',
].join('\n');

describe('parseWranglerTableRows', () => {
  it('reads the secret name out of the first column', () => {
    const names = parseWranglerTableRows(SECRET_LIST_OUTPUT).map((row) => row[0]);

    expect(names).toEqual(['aws-access-bridge-aes-encryption-key', 'aws-access-bridge-aes-encryption-key-2']);
  });

  it('ignores the header, the frame, and the log line', () => {
    // Six lines carry a U+2502 cell separator: the header, one rule-adjacent
    // row, the two secrets, and the borders. Only the two secrets are data.
    expect(parseWranglerTableRows(SECRET_LIST_OUTPUT)).toHaveLength(2);
  });

  it('does not shift later columns when an optional one is empty', () => {
    // `Comment` is blank, so the frame yields an empty cell that must be dropped
    // rather than pushing `ID` out of position.
    const [, id] = parseWranglerTableRows(SECRET_LIST_OUTPUT)[0] as [string, string];

    expect(id).toBe('0f1e2d3c4b5a69788796a5b4c3d2e1f0');
  });

  it('does not let a longer name satisfy a shorter one', () => {
    // The bug this replaced: `output.includes(secretName)` found
    // `aws-access-bridge-aes-encryption-key` inside
    // `aws-access-bridge-aes-encryption-key-2`, so the script skipped creating a
    // secret the store had never held.
    const names = parseWranglerTableRows(PREFIX_ONLY_OUTPUT).map((row) => row[0]);

    expect(names).toEqual(['aws-access-bridge-aes-encryption-key-2']);
    expect(names).not.toContain('aws-access-bridge-aes-encryption-key');
  });

  it('returns no rows for output with no table', () => {
    expect(parseWranglerTableRows('')).toEqual([]);
    expect(parseWranglerTableRows('\u{1F510} Listing secrets... (store-id: abc, page: 1, per-page: 10)')).toEqual([]);
  });
});

describe('isEmptySecretsStoreListing', () => {
  it('recognises the error wrangler raises for a store with no secrets', () => {
    // `secrets-store secret list` throws this as a FatalError and exits
    // non-zero, which is a confirmed absence rather than a failed listing.
    const error = new Error('Command failed: pnpm exec wrangler secrets-store secret list abc --remote\nList request returned no secrets.');

    expect(isEmptySecretsStoreListing(error)).toBe(true);
  });

  it('does not treat an unrelated failure as an empty store', () => {
    // This distinction is what stops a transient CLI failure from being read as
    // permission to create a secret that already holds a live AES master key.
    expect(isEmptySecretsStoreListing(new Error('Command failed: pnpm exec wrangler secrets-store secret list abc --remote\n'))).toBe(
      false,
    );
    expect(isEmptySecretsStoreListing(new Error('Authentication error [code: 10000]'))).toBe(false);
  });

  it('handles values that are not Errors', () => {
    expect(isEmptySecretsStoreListing('List request returned no secrets.')).toBe(true);
    expect(isEmptySecretsStoreListing(undefined)).toBe(false);
  });
});
