/**
 * Pagination bounds, shared so every listing endpoint agrees on them.
 *
 * `limit` is already validated by `positiveIntegerQuerySchema(..., MAX)` in the
 * request schemas, so the clamps below are a second line of defence rather than
 * the primary check — they matter for internal callers that bypass zod, and for
 * a query parameter that does not parse.
 */
class Pagination {
  /**
  Applied when a caller supplies no `limit`.
  */
  static readonly DEFAULT_LIMIT: number = 50;

  /**
  Ceiling, matching `positiveIntegerQuerySchema`'s cap on every listing route.
  */
  static readonly MAX_LIMIT: number = 200;

  /**
  Clamp to `[1, MAX_LIMIT]`, falling back to `DEFAULT_LIMIT`.
  */
  static limit(value?: number | string | null): number {
    const parsed: number | undefined = this.parse(value);
    return parsed === undefined ? this.DEFAULT_LIMIT : Math.min(Math.max(parsed, 1), this.MAX_LIMIT);
  }

  /**
  Clamp to a non-negative offset, defaulting to 0.
  */
  static offset(value?: number | string | null): number {
    const parsed: number | undefined = this.parse(value);
    return parsed === undefined || parsed < 0 ? 0 : parsed;
  }

  /**
   * `undefined` for anything that is not a finite number.
   *
   * The old `Math.min(Math.max(parseInt(x || '50'), 1), 200)` produced `NaN` for a
   * non-numeric parameter, which `LIMIT ?` then rejected at the database.
   */
  private static parse(value: number | string | null | undefined): number | undefined {
    if (['', null, undefined].includes(value as string | null | undefined)) {
      return undefined;
    }
    const parsed: number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }
}

export { Pagination };