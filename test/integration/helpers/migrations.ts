/**
 * Minimal SQL statement splitter for SQLite migration files.
 *
 * Handles: single/double/backtick quoted strings (incl. `''` escapes),
 * `--` line comments, `/* ... *\/` block comments. Semicolons inside strings
 * or comments do not split. Skips comment-only statements.
 */
function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        current += ch;
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      // Preserve line breaks so error line numbers stay meaningful.
      if (ch === '\n') {
        current += ch;
      }
      i++;
      continue;
    }

    if (inString) {
      current += ch;
      if (ch === stringChar && sql[i - 1] !== '\\') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      current += ch;
      inString = true;
      stringChar = ch;
      i++;
      continue;
    }

    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
  return statements;
}

interface MigrationFile {
  name: string;
  sql: string;
}

declare const __INTEGRATION_MIGRATION_FILES__: ReadonlyArray<{ name: string; sql: string }>;
declare const __INTEGRATION_MIGRATION_SQL__: string;

/**
 * Migration files, in apply order.
 *
 * Prefers the per-file injection so a test can address a specific migration by
 * name (the 0032 upgrade test needs to apply everything *before* it, seed a
 * populated database, and only then apply it). Falls back to the flattened
 * single-blob form for harnesses that only inject that.
 */
function migrationFiles(): MigrationFile[] {
  const files = typeof __INTEGRATION_MIGRATION_FILES__ === 'undefined' ? null : __INTEGRATION_MIGRATION_FILES__;
  if (files && files.length > 0) return [...files];
  return [{ name: 'all.sql', sql: __INTEGRATION_MIGRATION_SQL__ }];
}

/** Names of the embedded migration files, in apply order. */
function migrationFileNames(): string[] {
  return migrationFiles().map((f) => f.name);
}

/**
 * Apply the bundled migrations to `db`, at most once per database instance.
 *
 * D1 tracks which migrations have run; this helper does the same, because
 * `ALTER TABLE ... ADD COLUMN` is not idempotent in SQLite and re-running the
 * bundle fails with "duplicate column name". Each test file gets its own
 * database, so a module-scoped guard is the right scope.
 */
const appliedDatabases = new WeakMap<D1Database, string>();

/**
 * Apply a range of migrations, defaulting to every file.
 *
 * `from`/`to` are file names (`0031_distinct_credential_ivs.sql`). A range is
 * what the identity-upgrade test needs: apply everything up to and including
 * 0031, seed a populated legacy database, then apply 0032 alone.
 */
export async function applyMigrations(db: D1Database, range?: { from?: string; to?: string }): Promise<void> {
  const files = migrationFiles();
  const indexOf = (name: string | undefined, fallback: number): number => {
    if (!name) return fallback;
    const found = files.findIndex((f) => f.name === name);
    if (found === -1) {
      throw new Error(`Unknown migration file: ${name}. Available: ${files.map((f) => f.name).join(', ')}`);
    }
    return found;
  };
  const start = indexOf(range?.from, 0);
  const end = indexOf(range?.to, files.length - 1);
  const key = `${start}:${end}`;
  if (appliedDatabases.get(db) === key) return;
  for (const file of files.slice(start, end + 1)) {
    for (const statement of splitSql(file.sql)) {
      if (statement.length === 0) continue;
      await db.prepare(statement).run();
    }
  }
  appliedDatabases.set(db, key);
}

export { migrationFileNames, splitSql };
