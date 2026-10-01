/**
 * The comparison behind `scripts/migrations/verify-migrations.ts`.
 *
 * Pure and exported so every rule is testable without touching the filesystem.
 * The filesystem side of the script is a `readdirSync` and a `createHash`, and
 * neither is where the risk lives.
 *
 * ### Why a checksum lock at all
 *
 * D1 records *which* migrations it has applied — the filename and a timestamp —
 * but not *what the file contained* when it applied them. So editing a migration
 * that has already run is not caught by anything: the deploy still succeeds, the
 * local database built from the baseline plus the edited file picks up the new
 * statements, and production keeps the schema it had. The two databases then
 * differ silently and permanently, and the next migration that assumes the newer
 * shape fails only in production.
 *
 * A committed digest per file turns that into a CI failure. The lock is a
 * forward-only guard: it says nothing about migrations applied before it
 * existed, and it deliberately makes re-baselining a squashed file a visible
 * `--write` rather than a silent acceptance.
 *
 * ### Why the lock has a baseline
 *
 * `migrations/0030_squash.sql` is a squash: it holds the combined schema of every
 * migration before it, and those files are deleted when it is created. A later
 * squash repeats that. So a squash legitimately (a) rewrites one file and
 * (b) removes files the lock still lists, and neither may be reported as drift.
 *
 * The baseline is the highest-numbered `NNNN_squash.sql` on disk. Everything at
 * or before it is exempt from the `edited` and `orphan` checks, because that is
 * exactly the set a squash rewrites or absorbs. Everything strictly after it is
 * incremental, has been applied on top of the baseline, and is immutable — that
 * is the set the checks exist to protect, and it is the only set where a
 * divergence can be silent.
 */

/**
 * The lock format version this script understands.
 *
 * Bumped only if the shape changes incompatibly, so a stale lock fails loudly
 * rather than being read as "nothing is locked yet" and silently rewritten.
 */
export const LOCK_VERSION = 1;

/**
 * The prefix a digest is stored under, so a truncated or wrong-algorithm value
 * is visibly wrong rather than merely unequal.
 */
export const DIGEST_PREFIX = 'sha256:';

/**
 * A migration file as it exists on disk.
 */
export interface MigrationFile {
  /**
   * Bare filename, e.g. `0031_distinct_credential_ivs.sql`.
   */
  name: string;
  /**
   * `sha256:<hex>` over the file's raw bytes.
   */
  digest: string;
}

/**
 * The parsed `migrations/migrations.lock.json`.
 */
export interface MigrationLock {
  version: number;
  /**
   * The squashed baseline filename. Absent only in a lock that has not been
   * written yet, which `checkMigrations` reports as a `baseline` finding.
   */
  baseline?: string;
  migrations: Record<string, string>;
}

/**
 * Why a check failed. Kept as a union so the tests assert on the kind and not on
 * a substring of the message.
 *
 * `absent` and `malformed` are about the lock itself; the rest are about a
 * migration. Both suppress the per-file `unlocked` findings, because when there
 * is nothing usable to compare against, reporting every file as unlocked adds
 * nothing the first finding does not already say.
 */
export type FindingKind =
  'absent' | 'malformed' | 'baseline' | 'edited' | 'unlocked' | 'orphan' | 'name' | 'duplicate-prefix' | 'out-of-order';

/**
 * One failure. `detail` is the operator-facing explanation, kept out of `kind`
 * so a test can assert the kind without depending on the wording.
 */
export interface Finding {
  kind: FindingKind;
  /**
   * The file or lock entry the finding is about, or `''` when the finding is
   * about the lock as a whole.
   */
  subject: string;
  detail: string;
}

/**
 * The outcome of one run.
 */
export interface CheckResult {
  findings: Finding[];
  /**
   * Files with no lock entry, in apply order. Part of what `--write` records.
   */
  missing: MigrationFile[];
  /**
   * The lock as `--write` would leave it, or `null` when the existing lock
   * cannot be trusted as a base — which is exactly when a `--write` must refuse
   * rather than overwrite it.
   */
  updated: MigrationLock | null;
}

/**
 * The filename shape every migration must have.
 *
 * `NNNN_` is fixed at four digits because the numbering is the ordering: D1 sorts
 * by filename, so a migration that sorts *after* the ones already applied is the
 * only kind that can be introduced safely. A file that sorts before an applied
 * one will never be run by an existing database no matter what it contains.
 */
const MIGRATION_NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/**
 * The squashed-baseline shape. The highest-numbered match is the baseline.
 */
const SQUASH_NAME = /^\d{4}_squash\.sql$/;

/**
 * The 4-digit prefix of a well-named migration, or `undefined`.
 */
function prefixOf(name: string): string | undefined {
  return MIGRATION_NAME.exec(name)?.[1];
}

/**
 * The highest-numbered `NNNN_squash.sql` in `names`, or `undefined` when there
 * is none — a repository that has not squashed yet, where every migration is
 * incremental and therefore every one of them is immutable.
 */
export function baselineOf(names: readonly string[]): string | undefined {
  let highest: string | undefined;
  for (const name of names) {
    if (SQUASH_NAME.test(name) && (highest === undefined || name > highest)) {
      highest = name;
    }
  }
  return highest;
}

/**
 * True when `name` is at or before the baseline, i.e. the set a squash rewrites
 * or absorbs. With no baseline every file is incremental, so nothing is exempt.
 */
function isSubsumed(name: string, baseline: string | undefined): boolean {
  return baseline !== undefined && name <= baseline;
}

/**
 * Reads and validates a lock.
 *
 * `raw` is `null` when the file does not exist, which is a distinct, recoverable
 * condition — the fix is `--write` — rather than a malformed one.
 *
 * Every rejection is a finding rather than a thrown error, so one run reports
 * "the lock is malformed" alongside whatever else is wrong instead of stopping
 * at the first problem.
 */
export function parseLock(raw: string | null): { lock: MigrationLock | null; findings: Finding[] } {
  if (raw === null) {
    return {
      lock: null,
      findings: [{ kind: 'absent', subject: '', detail: 'does not exist. Run with --write to create it from the migrations on disk.' }],
    };
  }

  const findings: Finding[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    findings.push({
      kind: 'malformed',
      subject: '',
      detail: `is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { lock: null, findings };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    findings.push({ kind: 'malformed', subject: '', detail: 'must be a JSON object' });
    return { lock: null, findings };
  }

  const { version, baseline, migrations } = parsed as { version?: unknown; baseline?: unknown; migrations?: unknown };

  if (version !== LOCK_VERSION) {
    findings.push({ kind: 'malformed', subject: 'version', detail: `is ${JSON.stringify(version)}, expected ${LOCK_VERSION}` });
  }

  if (baseline !== undefined && (typeof baseline !== 'string' || !MIGRATION_NAME.test(baseline))) {
    findings.push({
      kind: 'malformed',
      subject: 'baseline',
      detail: `must be a NNNN_snake_case.sql string, found ${JSON.stringify(baseline)}`,
    });
  }

  if (typeof migrations !== 'object' || migrations === null || Array.isArray(migrations)) {
    findings.push({ kind: 'malformed', subject: 'migrations', detail: 'must be a JSON object' });
    return { lock: null, findings };
  }

  for (const [name, digest] of Object.entries(migrations as Record<string, unknown>)) {
    if (typeof digest !== 'string' || !digest.startsWith(DIGEST_PREFIX)) {
      findings.push({
        kind: 'malformed',
        subject: name,
        detail: `must be a "${DIGEST_PREFIX}<hex>" string, found ${JSON.stringify(digest)}`,
      });
    }
  }

  if (findings.length > 0) {
    return { lock: null, findings };
  }

  return {
    lock: {
      version: LOCK_VERSION,
      ...(typeof baseline === 'string' && { baseline }),
      migrations: { ...(migrations as Record<string, string>) },
    },
    findings,
  };
}

/**
 * Names that fail the `NNNN_snake_case.sql` shape.
 *
 * Checked on disk files *and* lock entries: an entry under a name the format
 * rejects cannot have come from a well-formed migration, and a wrong name is the
 * one thing a hand-written lock entry is most likely to get wrong.
 */
function badNames(names: readonly string[]): Finding[] {
  return names
    .filter((name) => !MIGRATION_NAME.test(name))
    .map((name) => ({ kind: 'name', subject: name, detail: 'does not match NNNN_snake_case.sql' }));
}

/**
 * Files sharing a 4-digit prefix.
 *
 * Two files numbered `0033_` are not a style problem: D1 orders them by the rest
 * of the filename, so which one lands on a given database depends on a
 * lexicographic tiebreak nobody intended, and a database that already ran one of
 * them can never run the other.
 */
function duplicatePrefixes(names: readonly string[]): Finding[] {
  const byPrefix = new Map<string, string[]>();
  // Deduped, because the caller passes disk names and lock keys together and
  // every locked file is by definition also on disk — so without this every
  // correctly-locked migration reports itself as a duplicate of itself.
  const distinct = [...new Set(names)];
  for (const name of distinct) {
    const prefix = prefixOf(name);
    if (prefix === undefined) {
      continue;
    }
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
  }

  return [...byPrefix]
    .filter(([, group]) => group.length > 1)
    .map(([prefix, group]) => ({ kind: 'duplicate-prefix', subject: prefix, detail: `is used by ${group.join(', ')}` }));
}

/**
 * Compares the migrations on disk against the lock.
 *
 * Reports every problem rather than the first, so one run tells the operator the
 * whole list. `files` must be in apply order (the filename sort D1 itself uses).
 */
export function checkMigrations(
  files: readonly MigrationFile[],
  lock: MigrationLock | null,
  lockFindings: readonly Finding[] = [],
): CheckResult {
  const findings: Finding[] = [...lockFindings];
  const names = files.map((file) => file.name);
  const locked = lock?.migrations ?? {};
  const usable = lock !== null;

  findings.push(...badNames(names), ...badNames(Object.keys(locked)), ...duplicatePrefixes([...names, ...Object.keys(locked)]));

  const onDisk = new Set(names);
  const inLock = new Set(Object.keys(locked));

  // Derived from disk rather than trusted from the lock, so a stale or forged
  // `baseline` cannot widen the exempt set. The recorded value is only ever
  // compared against this.
  const computedBaseline = baselineOf(names);
  const recordedBaseline = lock?.baseline;

  // Only a *recorded* baseline can be stale. With no lock at all there is nothing
  // to disagree with, and the `absent` finding already names the fix, so adding a
  // `baseline` one on top would report the same problem twice.
  if (usable && recordedBaseline !== computedBaseline) {
    findings.push({
      kind: 'baseline',
      subject: 'baseline',
      detail:
        computedBaseline === undefined
          ? `is ${JSON.stringify(recordedBaseline ?? null)} but no NNNN_squash.sql is on disk, so every migration is incremental and immutable. Run with --write to record that.`
          : `is ${JSON.stringify(recordedBaseline ?? null)} but the highest-numbered squash on disk is ${computedBaseline}. Run with --write to record it; that is how a squash is adopted.`,
    });
  }

  // The baseline the exemption is judged against: the computed one. Using the
  // recorded one instead would let a lock claiming a later baseline suppress
  // checks on migrations that have not been squashed yet.
  const baseline = computedBaseline;

  for (const file of files) {
    const recorded = locked[file.name];
    if (recorded === undefined || recorded === file.digest) {
      continue;
    }
    if (isSubsumed(file.name, baseline)) {
      // A squash rewrites its own file; that is what the baseline is for.
      continue;
    }
    findings.push({
      kind: 'edited',
      subject: file.name,
      detail: `was locked as ${recorded} but is now ${file.digest}. It is incremental, so D1 has already applied it to a live database and will never apply this. Restore the file, or carry the change in a new NNNN_ migration.`,
    });
  }

  // Only meaningful once there is a lock to be missing an entry from. A file
  // unlocked because the whole lock is absent is already covered by that finding.
  const missing = usable ? files.filter((file) => !inLock.has(file.name)) : [];

  if (usable) {
    for (const file of missing) {
      findings.push({
        kind: 'unlocked',
        subject: file.name,
        detail:
          'is not in the lock. D1 will apply it to a database that has not seen it, and nothing here can say what it contained. Run with --write to record it.',
      });
    }
  }

  for (const name of inLock) {
    if (onDisk.has(name) || isSubsumed(name, baseline)) {
      // At or before the baseline: a squash absorbs it, and the baseline's own
      // digest is what the schema is now described by.
      continue;
    }
    findings.push({
      kind: 'orphan',
      subject: name,
      detail:
        'is in the lock but not on disk, and is incremental rather than squashed. It has been applied to a live database, and that step is no longer reproducible from this repository.',
    });
  }

  // A file sorting before the newest locked one can never reach a database that
  // has already applied that newest one, so its statements would only run on a
  // fresh build — the same silent split the checksum exists to prevent.
  let cutoff: string | undefined;
  for (const name of inLock) {
    if (cutoff === undefined || name > cutoff) {
      cutoff = name;
    }
  }
  for (const name of names) {
    if (cutoff !== undefined && name < cutoff && !inLock.has(name)) {
      findings.push({
        kind: 'out-of-order',
        subject: name,
        detail: `sorts before ${cutoff}, which is already locked. D1 applies migrations in filename order, so this would never run on a database that has applied ${cutoff}.`,
      });
    }
  }

  const next = buildUpdated(
    files,
    lock,
    missing,
    baseline,
    lockFindings.some((finding) => finding.kind === 'malformed'),
  );
  return { findings, missing, updated: next };
}

/**
 * The lock as `--write` would leave it.
 *
 * Add-only where it counts, and deliberately not add-only everywhere:
 *
 * - Unlocked files are added. That is the new-migration case.
 * - The baseline's entry is refreshed, and entries at or before it for files that
 *   are gone are dropped. Both are what committing a squash looks like, and
 *   neither can hide a divergence because a database that applied those files
 *   already has them recorded in D1's own `d1_migrations`.
 * - Every other entry is left exactly as it is. An incremental `edited` finding
 *   therefore survives a `--write`; re-baselining one means deleting its entry by
 *   hand, which is visible in the diff.
 *
 * `null` when the lock is malformed, so a `--write` cannot overwrite contents it
 * failed to understand. A lock that is merely *absent* is not malformed: that is
 * the bootstrap case, and it is built from disk like any other.
 */
function buildUpdated(
  files: readonly MigrationFile[],
  lock: MigrationLock | null,
  missing: readonly MigrationFile[],
  baseline: string | undefined,
  malformed: boolean,
): MigrationLock | null {
  if (malformed) {
    return null;
  }
  if (lock === null) {
    return {
      version: LOCK_VERSION,
      ...(baseline !== undefined && { baseline }),
      migrations: Object.fromEntries(files.map((file) => [file.name, file.digest])),
    };
  }

  const kept = new Map<string, string>();
  for (const file of files) {
    const recorded = lock.migrations[file.name];
    if (recorded === undefined) {
      continue;
    }
    // The baseline is the one file a squash is allowed to rewrite.
    kept.set(file.name, file.name === baseline ? file.digest : recorded);
  }
  for (const file of missing) {
    kept.set(file.name, file.digest);
  }

  const migrations = Object.fromEntries([...kept].toSorted(([left], [right]) => left.localeCompare(right)));
  const updated: MigrationLock = {
    version: LOCK_VERSION,
    ...(baseline !== undefined && { baseline }),
    migrations,
  };

  return JSON.stringify(lock) === JSON.stringify(updated) ? lock : updated;
}
