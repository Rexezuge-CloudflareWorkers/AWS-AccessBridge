/**
 * Escape the LIKE metacharacters in a user-supplied search term.
 *
 * `%`, `_` and `\` are wildcards in a `LIKE` pattern, so an unescaped term turns
 * a search box into a way to dump the table: searching for `%` returns every
 * row. The value is still bound, so this is not an injection — it is that the
 * caller gets results they never asked for.
 *
 * Pair with `ESCAPE '\'` on the pattern; `LIKEUtil.contains` builds both halves.
 */
class LIKEUtil {
  static readonly ESCAPE: string = '\\';

  static escape(term: string): string {
    return term.replaceAll(/[\\%_]/g, (character) => `${this.ESCAPE}${character}`);
  }

  /**
  A `LIKE` pattern matching `term` as a substring, with wildcards neutralised.
  */
  static contains(term: string): string {
    return `%${this.escape(term)}%`;
  }

  /**
  The SQL fragment to place after `LIKE` so the escape character is honoured.
  */
  static get escapeClause(): string {
    return `ESCAPE '${this.ESCAPE}'`;
  }
}

export { LIKEUtil };