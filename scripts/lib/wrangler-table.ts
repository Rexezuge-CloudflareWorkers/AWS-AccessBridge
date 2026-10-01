/**
 * Parsers for the human-readable tables `wrangler` prints.
 *
 * `wrangler secrets-store …` renders through `cli-table3`, which draws a
 * box-drawing frame and separates cells with U+2502 (`│`) padded by exactly one
 * space. Columns are therefore *not* space-aligned, and a parser written for
 * space-aligned output silently matches nothing — which reads as "the resource
 * is absent". Split on the frame character instead.
 */

/**
 * Cell separator emitted by `cli-table3`.
 */
const COLUMN_SEPARATOR = String.fromCodePoint(0x25_02);

/**
 * Horizontal rule drawn by `cli-table3`; a row made of these is not data.
 */
const RULE_CHARACTER = String.fromCodePoint(0x25_00);

/**
 * Header row of every `wrangler … list` table.
 */
const HEADER_FIRST_CELL = 'Name';

/**
 * wrangler exits non-zero when a Secrets Store holds no secrets
 * (`secrets-store secret list` throws this `FatalError`), which is
 * indistinguishable by exit code from a genuine failure.
 */
const EMPTY_STORE_MESSAGE = 'List request returned no secrets';

/**
 * Extracts the data rows of a `wrangler` table, dropping the frame, the header,
 * and any surrounding log lines.
 *
 * Rows are returned in print order with cells trimmed and empty cells removed,
 * so a blank optional column (`Comment`, typically unset) does not shift the
 * columns a caller indexes into.
 */
export function parseWranglerTableRows(output: string): string[][] {
  const rows: string[][] = [];
  for (const line of output.split('\n')) {
    // The frame rows use U+253C (`┼`) at the joints rather than U+2502, so they
    // are already excluded here; the rule-character guard below additionally
    // covers borders that happen to contain a separator.
    if (!line.includes(COLUMN_SEPARATOR)) {
      continue;
    }

    const cells: string[] = line
      .split(COLUMN_SEPARATOR)
      .map((cell) => cell.trim())
      .filter(Boolean);
    const firstCell = cells[0];
    if (firstCell === undefined || cells.length < 2) {
      continue;
    }
    // The header row and the horizontal rules are frame, not data.
    if (firstCell === HEADER_FIRST_CELL || firstCell.includes(RULE_CHARACTER)) {
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * True when a failed `secrets-store secret list` means the store is empty
 * rather than the listing having failed.
 *
 * Callers must treat this as a confirmed absence; every other failure has to
 * stay indistinguishable from "unknown", or a transient CLI error would be read
 * as permission to create a secret that already holds a live value.
 */
export function isEmptySecretsStoreListing(error: unknown): boolean {
  const message: string = error instanceof Error ? error.message : String(error);
  return message.includes(EMPTY_STORE_MESSAGE);
}
