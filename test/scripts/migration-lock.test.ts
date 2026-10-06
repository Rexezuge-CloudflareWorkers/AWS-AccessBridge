import { describe, expect, it } from 'vitest';
import {
  baselineOf,
  checkMigrations,
  LOCK_VERSION,
  parseLock,
  type MigrationFile,
  type MigrationLock,
} from '../../scripts/migrations/lock-check';

const digest = (hex: string): string => `sha256:${hex}`;
const A = digest('aaaa');
const B = digest('bbbb');
const C = digest('cccc');

const file = (name: string, d: string): MigrationFile => ({ name, digest: d });

/**
 * A lock over the three-file layout this repository actually has: a squash
 * baseline and two incremental migrations on top of it.
 */
const repoLock = (overrides: Partial<MigrationLock> = {}): MigrationLock => ({
  version: LOCK_VERSION,
  baseline: '0030_squash.sql',
  migrations: { '0030_squash.sql': A, '0031_distinct_credential_ivs.sql': B, '0032_user_identity.sql': C },
  ...overrides,
});

const repoFiles: MigrationFile[] = [
  file('0030_squash.sql', A),
  file('0031_distinct_credential_ivs.sql', B),
  file('0032_user_identity.sql', C),
];

/**
 * The finding kinds, in the order the checker emits them, for asserting on the
 * rules rather than on the wording of a message.
 */
const kinds = (result: { findings: { kind: string }[] }): string[] => result.findings.map((finding) => finding.kind);

/**
`kinds` for a `parseLock` result, which returns the findings directly.
*/
const parseKinds = (raw: string | null): string[] => parseLock(raw).findings.map((finding) => finding.kind);

describe('parseLock', () => {
  it('reads a well-formed lock', () => {
    const { lock, findings } = parseLock(JSON.stringify(repoLock()));

    expect(findings).toEqual([]);
    expect(lock).toEqual(repoLock());
  });

  it('reports a missing lock as absent rather than malformed, and names the fix', () => {
    // The distinction is what lets `--write` bootstrap: a missing file is a state
    // to be created, a broken one is contents that must not be overwritten.
    const { lock, findings } = parseLock(null);

    expect(lock).toBeNull();
    expect(parseKinds(null)).toEqual(['absent']);
    expect(findings[0]?.detail).toContain('--write');
  });

  it('reports unparseable JSON instead of throwing', () => {
    const { lock, findings } = parseLock('{ not json');

    expect(lock).toBeNull();
    expect(parseKinds('{ not json')).toEqual(['malformed']);
    expect(findings[0]?.kind).toBe('malformed');
  });

  it('rejects a non-object document', () => {
    expect(kinds(parseLock('[]'))).toEqual(['malformed']);
    expect(kinds(parseLock('"x"'))).toEqual(['malformed']);
    expect(kinds(parseLock('null'))).toEqual(['malformed']);
  });

  it('rejects an unknown version rather than reading it as empty', () => {
    // Otherwise a future lock format is silently treated as "nothing locked yet"
    // and then overwritten with a downgrade of itself.
    const { lock, findings } = parseLock(JSON.stringify({ version: 99, migrations: {} }));

    expect(lock).toBeNull();
    expect(findings[0]?.detail).toContain('expected 1');
  });

  it('rejects a non-string digest', () => {
    expect(parseKinds(JSON.stringify({ version: LOCK_VERSION, migrations: { '0030_squash.sql': 123 } }))).toEqual(['malformed']);
  });

  it('rejects a digest with the wrong prefix', () => {
    expect(parseKinds(JSON.stringify({ version: LOCK_VERSION, migrations: { '0030_squash.sql': 'md5:abcd' } }))).toEqual(['malformed']);
  });

  it('rejects a baseline that is not a migration filename', () => {
    expect(parseKinds(JSON.stringify({ version: LOCK_VERSION, baseline: 'nope', migrations: {} }))).toEqual(['malformed']);
  });

  it('accepts a lock with no baseline key at all', () => {
    // A repository that has not squashed yet has no baseline, which is valid.
    const { lock, findings } = parseLock(JSON.stringify({ version: LOCK_VERSION, migrations: { '0001_init.sql': A } }));

    expect(findings).toEqual([]);
    expect(lock).toEqual({ version: LOCK_VERSION, migrations: { '0001_init.sql': A } });
  });
});

describe('baselineOf', () => {
  it('picks the highest-numbered squash', () => {
    expect(baselineOf(['0020_squash.sql', '0030_squash.sql', '0031_more.sql'])).toBe('0030_squash.sql');
  });

  it('returns undefined when nothing is squashed', () => {
    expect(baselineOf(['0001_init.sql', '0002_more.sql'])).toBeUndefined();
  });

  it('does not treat a file merely containing "squash" as the baseline', () => {
    // The shape is the whole point: `0033_squashed_notes.sql` is a migration
    // about squashing, not a squash of the schema.
    expect(baselineOf(['0033_squashed_notes.sql'])).toBeUndefined();
  });
});

describe('checkMigrations — a matching lock', () => {
  it('reports nothing', () => {
    expect(checkMigrations(repoFiles, repoLock()).findings).toEqual([]);
  });

  it('does not report a correctly-locked file as a duplicate of itself', () => {
    // Disk names and lock keys are concatenated before the prefix check, so the
    // dedupe is load-bearing rather than cosmetic.
    expect(kinds(checkMigrations(repoFiles, repoLock()))).not.toContain('duplicate-prefix');
  });
});

describe('checkMigrations — edited migrations', () => {
  it('fails when an incremental migration no longer matches its digest', () => {
    // The reason the lock exists: D1 has already applied the old text and will
    // never apply this, so production silently keeps the old schema.
    const result = checkMigrations([...repoFiles.slice(0, 2), file('0032_user_identity.sql', digest('dddd'))], repoLock());

    expect(kinds(result)).toEqual(['edited']);
    expect(result.findings[0]?.subject).toBe('0032_user_identity.sql');
  });

  it('does not let --write adopt the new digest', () => {
    // Otherwise a stray --write blesses the edit and the guard is a suggestion.
    const drifted = [...repoFiles.slice(0, 2), file('0032_user_identity.sql', digest('dddd'))];
    const result = checkMigrations(drifted, repoLock());

    expect(result.updated?.migrations['0032_user_identity.sql']).toBe(C);
  });

  it('does not fail when the baseline itself is rewritten', () => {
    // A squash rewrites its own file by definition; that is the baseline's job.
    const result = checkMigrations([file('0030_squash.sql', digest('eeee')), ...repoFiles.slice(1)], repoLock());

    expect(result.findings).toEqual([]);
  });

  it('refreshes the baseline digest under --write', () => {
    const result = checkMigrations([file('0030_squash.sql', digest('eeee')), ...repoFiles.slice(1)], repoLock());

    expect(result.updated?.migrations['0030_squash.sql']).toBe(digest('eeee'));
  });
});

describe('checkMigrations — unlocking a new migration', () => {
  it('fails on a file with no entry', () => {
    const result = checkMigrations([...repoFiles, file('0033_new_thing.sql', digest('ffff'))], repoLock());

    expect(kinds(result)).toEqual(['unlocked']);
    expect(result.missing.map((m) => m.name)).toEqual(['0033_new_thing.sql']);
  });

  it('adds it under --write, and the result then verifies clean', () => {
    const files = [...repoFiles, file('0033_new_thing.sql', digest('ffff'))];
    const written = checkMigrations(files, repoLock()).updated;

    expect(written).not.toBeNull();
    expect(checkMigrations(files, written).findings).toEqual([]);
  });

  it('does not report every file as unlocked when the lock is absent', () => {
    // The `absent` finding already says it; N identical lines add nothing.
    const result = checkMigrations(repoFiles, null, parseLock(null).findings);

    expect(kinds(result)).toEqual(['absent']);
    expect(result.missing).toEqual([]);
  });
});

describe('checkMigrations — deleted migrations', () => {
  it('fails when an incremental migration disappears', () => {
    // Applied to a live database, and no longer reproducible from the repo.
    const result = checkMigrations(repoFiles.slice(0, 2), repoLock());

    expect(kinds(result)).toEqual(['orphan']);
    expect(result.findings[0]?.subject).toBe('0032_user_identity.sql');
  });

  it('drops it under --write only if it is at or before the baseline', () => {
    const gone = repoFiles.slice(0, 2);
    const squashed = checkMigrations(gone, { ...repoLock(), baseline: '0032_user_identity.sql' }).updated;

    expect(squashed?.migrations).toEqual({ '0030_squash.sql': A, '0031_distinct_credential_ivs.sql': B });
  });
});

describe('checkMigrations — squashing', () => {
  it('adopts a higher-numbered baseline and prunes what it absorbed', () => {
    // The scenario a squash produces: one new file holding the combined schema,
    // and the files it subsumes deleted.
    const squashed: MigrationFile[] = [file('0033_squash.sql', digest('9999'))];
    const result = checkMigrations(squashed, repoLock());

    expect(kinds(result)).toContain('baseline');
    expect(kinds(result)).toContain('unlocked');

    const written = result.updated;
    expect(written?.baseline).toBe('0033_squash.sql');
    expect(written?.migrations).toEqual({ '0033_squash.sql': digest('9999') });
    expect(checkMigrations(squashed, written).findings).toEqual([]);
  });

  it('reports a recorded baseline that no longer exists on disk', () => {
    const result = checkMigrations([file('0001_init.sql', A)], {
      version: LOCK_VERSION,
      baseline: '0030_squash.sql',
      migrations: { '0001_init.sql': A },
    });

    expect(kinds(result)).toEqual(['baseline']);
    expect(result.findings[0]?.detail).toContain('no NNNN_squash.sql is on disk');
  });

  it('ignores a forged baseline when deciding what is exempt', () => {
    // The exemption is judged against the baseline derived from disk, so a lock
    // claiming a later squash cannot suppress checks on migrations not yet
    // squashed.
    const forged: MigrationLock = { version: LOCK_VERSION, baseline: '0099_squash.sql', migrations: { ...repoLock().migrations } };
    const result = checkMigrations([file('0030_squash.sql', A), file('0031_distinct_credential_ivs.sql', digest('dddd'))], forged);

    expect(kinds(result)).toContain('edited');
  });

  it('treats every migration as immutable when there is no baseline', () => {
    const noBaseline: MigrationLock = { version: LOCK_VERSION, migrations: { '0001_init.sql': A } };
    const result = checkMigrations([file('0001_init.sql', digest('bbbb'))], noBaseline);

    expect(kinds(result)).toEqual(['edited']);
  });

  it('drops the baseline key under --write when no squash remains', () => {
    const result = checkMigrations([file('0001_init.sql', A)], repoLock());

    expect(result.updated).not.toHaveProperty('baseline');
  });
});

describe('checkMigrations — ordering and naming', () => {
  it('fails a new file that sorts before one already locked', () => {
    // D1 applies in filename order, so this would never run on a database that
    // has already applied 0032 — the same silent split the digest prevents.
    const result = checkMigrations([...repoFiles, file('0029_late.sql', digest('7777'))], repoLock());

    expect(kinds(result)).toContain('out-of-order');
    expect(result.findings.find((f) => f.kind === 'out-of-order')?.subject).toBe('0029_late.sql');
  });

  it('fails two files sharing a 4-digit prefix', () => {
    // Which one runs depends on a lexicographic tiebreak nobody intended.
    const result = checkMigrations([...repoFiles, file('0032_other.sql', digest('8888'))], repoLock());

    expect(kinds(result)).toContain('duplicate-prefix');
  });

  it.each([
    ['no_number.sql'],
    ['34_two_digits.sql'],
    ['0034_Bad-Case.sql'],
    ['0036.sql'],
    ['0037__leading.sql'],
    ['0038_trailing_.sql'],
    ['0039_UPPER.sql'],
  ])('fails the malformed name %s', (name) => {
    expect(kinds(checkMigrations([...repoFiles, file(name, digest('aaaa'))], repoLock()))).toContain('name');
  });

  it('accepts a multi-segment snake_case name', () => {
    const name = '0033_add_user_email_registry.sql';

    expect(checkMigrations([...repoFiles, file(name, digest('aaaa'))], repoLock()).findings.map((f) => f.kind)).toEqual(['unlocked']);
  });

  it('fails a lock entry whose name is malformed', () => {
    const result = checkMigrations(repoFiles, {
      version: LOCK_VERSION,
      baseline: '0030_squash.sql',
      migrations: { ...repoLock().migrations, 'Oops.sql': A },
    });

    expect(kinds(result)).toContain('name');
  });
});

describe('checkMigrations — refusing to overwrite what it cannot read', () => {
  it('returns no update for a malformed lock', () => {
    const { findings } = parseLock('{ broken');
    const result = checkMigrations(repoFiles, null, findings);

    expect(result.updated).toBeNull();
  });

  it('builds a lock from disk when the lock is merely absent', () => {
    // Not malformed: this is the bootstrap case, and it must be creatable.
    const result = checkMigrations(repoFiles, null, parseLock(null).findings);

    expect(result.updated).toEqual(repoLock());
  });

  it('returns the same lock object when nothing needs changing, so --write is a no-op', () => {
    const lock = repoLock();

    expect(checkMigrations(repoFiles, lock).updated).toBe(lock);
  });

  it('emits migrations in filename order, whatever order the lock used', () => {
    const shuffled: MigrationLock = {
      version: LOCK_VERSION,
      baseline: '0030_squash.sql',
      migrations: { '0032_user_identity.sql': C, '0030_squash.sql': A, '0031_distinct_credential_ivs.sql': B },
    };

    expect(Object.keys(checkMigrations(repoFiles, shuffled).updated?.migrations ?? {})).toEqual([
      '0030_squash.sql',
      '0031_distinct_credential_ivs.sql',
      '0032_user_identity.sql',
    ]);
  });
});

describe('checkMigrations — a real squashed repository', () => {
  it('reports several problems at once rather than only the first', () => {
    const result = checkMigrations(
      [file('0030_squash.sql', digest('1111')), file('0032_user_identity.sql', C), file('0033_brand_new.sql', digest('2222'))],
      {
        version: LOCK_VERSION,
        baseline: '0030_squash.sql',
        migrations: { '0030_squash.sql': A, '0031_distinct_credential_ivs.sql': B, '0032_user_identity.sql': C },
      },
    );

    // The edited baseline is exempt, so the two real problems are the deleted
    // 0031 and the unrecorded 0033. Asserted as a set: the order is an
    // implementation detail, the point is that neither is hidden by the other.
    expect(new Set(kinds(result))).toEqual(new Set(['orphan', 'unlocked']));
  });
});
