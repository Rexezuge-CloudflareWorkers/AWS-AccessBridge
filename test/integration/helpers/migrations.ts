/**
 * Split a migration file into individual statements for `db.prepare(...).run()`.
 *
 * D1 has no multi-statement `exec`, so migrations are applied one statement at a
 * time. The scanner must skip semicolons that are not statement terminators:
 * inside string literals and inside SQL comments. A `--` comment containing a
 * semicolon would otherwise be split mid-sentence and sent to SQLite as a
 * bogus statement.
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

/**
 * Apply the bundled migrations to `db`, at most once per database instance.
 *
 * D1 tracks which migrations have run; this helper does the same, because
 * `ALTER TABLE ... ADD COLUMN` is not idempotent in SQLite and re-running the
 * bundle fails with "duplicate column name". Each test file gets its own
 * database, so a module-scoped guard is the right scope.
 */
const appliedDatabases = new WeakSet<D1Database>();

export async function applyMigrations(db: D1Database): Promise<void> {
  if (appliedDatabases.has(db)) {
    return;
  }
  const statements = splitSql(__INTEGRATION_MIGRATION_SQL__);
  for (const stmt of statements) {
    if (stmt.length === 0) continue;
    await db.prepare(stmt).run();
  }
  appliedDatabases.add(db);
}
