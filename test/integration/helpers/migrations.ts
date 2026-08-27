function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === stringChar && sql[i - 1] !== '\\') {
        inString = false;
      }
    } else if (ch === "'" || ch === '"') {
      current += ch;
      inString = true;
      stringChar = ch;
    } else if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += ch;
    }
    i++;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
  return statements;
}

export async function applyMigrations(db: D1Database): Promise<void> {
  const statements = splitSql(__INTEGRATION_MIGRATION_SQL__);
  for (const stmt of statements) {
    if (stmt.length === 0) continue;
    await db.prepare(stmt).run();
  }
}
