import { describe, expect, it } from 'vitest';
import { checkShell, MIN_HTML_BYTES, readEmbeddedHtml, referencedAssets, SPA_HTML_MARKER } from '../../scripts/build/spa-shell-checks';

/**
 * The shell checks, as rules.
 *
 * The whole point of this check is that the Worker serves the SPA shell **embedded from
 * a gitignored build artifact**, so a wrong one is a blank page with nothing in the
 * source tree saying so. That makes each finding an operator's only clue, and the
 * failure mode of the check itself is silently passing — a check that cannot fail is
 * indistinguishable from a shell that is fine.
 */

/**
A generated module holding `html`, the way the Vite plugin writes it.
*/
function shellSource(html: string): string {
  return `// Auto-generated\nexport const SPA_HTML: string = ${JSON.stringify(html)};\n`;
}

/**
 * A realistic Vite build output: long enough to clear `MIN_HTML_BYTES`, which the
 * fixture below asserts rather than assumes — a 183-character "real" page made eight
 * of these tests fail for the wrong reason, which is itself the lesson.
 */
const REAL_HTML = [
  '<!doctype html><html lang="en"><head>',
  '<meta charset="UTF-8" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '<title>Edge-Sonic</title>',
  '</head><body>',
  '<div id="root"></div>',
  '<script type="module" crossorigin src="/assets/index-abc123.js"></script>',
  '</body></html>',
].join('');

describe('readEmbeddedHtml', () => {
  it('clears its own size threshold, so the fixtures below are testing what they claim', () => {
    // A "real" page fixture that is shorter than `MIN_HTML_BYTES` fails every test that
    // depends on the shell decoding, and reports `too-small` for a reason that has
    // nothing to do with the assertion under test.
    expect(REAL_HTML.length).toBeGreaterThan(MIN_HTML_BYTES);
  });

  it('decodes a real build output', () => {
    expect(readEmbeddedHtml(shellSource(REAL_HTML))).toEqual({ html: REAL_HTML, problems: [] });
  });

  it('names the empty postinstall stub rather than reporting it as malformed', () => {
    // The most common failure by far — a fresh clone that never ran the build — and it
    // deserves the actionable message rather than a parse error.
    const result = readEmbeddedHtml(`${SPA_HTML_MARKER}'';`);
    expect(result.html).toBeNull();
    expect(result.problems.map((problem) => problem.code)).toEqual(['stub']);
    expect(result.problems[0]?.detail).toContain('pnpm run build');
  });

  it('names a module that does not export SPA_HTML', () => {
    const result = readEmbeddedHtml('export const SOMETHING_ELSE = 1;');
    expect(result.problems.map((problem) => problem.code)).toEqual(['unexported']);
  });

  it('names a value that is too short to be a page', () => {
    const result = readEmbeddedHtml(shellSource('<!doctype html>'));
    expect(result.problems.map((problem) => problem.code)).toEqual(['too-small']);
    // The *observed* length, not the threshold: what the operator has is a file to look
    // at, and "15 chars" names it where "must be at least 200" does not.
    expect(result.problems[0]?.detail).toContain('15 chars');
  });

  it('names a literal that is not a string, rather than throwing on `.length`', () => {
    const result = readEmbeddedHtml(`${SPA_HTML_MARKER}42;`);
    expect(result.problems.map((problem) => problem.code)).toEqual(['malformed']);
  });

  it('names a literal that does not parse', () => {
    const result = readEmbeddedHtml(`${SPA_HTML_MARKER}'not json';`);
    expect(result.problems.map((problem) => problem.code)).toEqual(['malformed']);
  });

  it('accepts a shell with no leading marker comment', () => {
    // The plugin's output shape is the contract, not the comment above it.
    expect(readEmbeddedHtml(shellSource(REAL_HTML)).html).toBe(REAL_HTML);
  });
});

describe('referencedAssets', () => {
  it('collects same-origin asset paths, deduped', () => {
    const html = '<script src="/assets/a.js"></script><link href="/assets/a.css"><script src="/assets/b.js">';
    expect(referencedAssets(html).toSorted((left, right) => left.localeCompare(right))).toEqual(['a.css', 'a.js', 'b.js']);
  });

  it('ignores an absolute URL, which dist/assets cannot be expected to hold', () => {
    expect(referencedAssets('<script src="https://cdn.example.com/a.js">')).toEqual([]);
  });
});

describe('checkShell', () => {
  const has = (names: string[]) => (asset: string) => names.includes(asset);

  it('passes when the shell, its assets and dist agree', () => {
    expect(checkShell(shellSource(REAL_HTML), REAL_HTML, has(['index-abc123.js']))).toEqual([]);
  });

  it('names a missing shell and stops, because there is nothing to check against', () => {
    expect(checkShell(null, REAL_HTML, has([])).map((problem) => problem.code)).toEqual(['missing']);
  });

  it('names an asset the shell references but dist does not hold', () => {
    // A shell whose JS 404s renders no operator UI at all, and it looks fine in review.
    const problems = checkShell(shellSource(REAL_HTML), REAL_HTML, has([]));
    expect(problems.map((problem) => problem.code)).toEqual(['missing-asset']);
    expect(problems[0]?.detail).toContain('/assets/index-abc123.js');
  });

  it('names a shell referencing no bundles at all', () => {
    const html = `<!doctype html><html><body>${'x'.repeat(MIN_HTML_BYTES)}</body></html>`;
    expect(checkShell(shellSource(html), html, has([])).map((problem) => problem.code)).toEqual(['no-assets']);
  });

  it('names a disagreement between the two halves of the build', () => {
    const problems = checkShell(shellSource(REAL_HTML), `${REAL_HTML}<!-- rebuilt -->`, has(['index-abc123.js']));
    expect(problems.map((problem) => problem.code)).toEqual(['disagreement']);
  });

  it('names a missing dist, rather than reporting a disagreement with nothing', () => {
    expect(checkShell(shellSource(REAL_HTML), null, has(['index-abc123.js'])).map((problem) => problem.code)).toEqual(['dist-missing']);
  });

  it('reports every independent problem, not just the first', () => {
    // All three are "the build is not what you think it is", and an operator fixing one
    // and re-running should not have to discover the next by iteration.
    const problems = checkShell(shellSource(REAL_HTML), null, has([]));
    expect(problems.map((problem) => problem.code).toSorted((left, right) => left.localeCompare(right))).toEqual(['dist-missing', 'missing-asset']);
  });

  it('does not check assets against a shell it could not decode', () => {
    // Reporting "references no assets" for an unreadable shell would name the wrong
    // thing and send an operator to rebuild for no reason.
    const problems = checkShell(`${SPA_HTML_MARKER}'';`, null, has([]));
    expect(problems.map((problem) => problem.code)).toEqual(['stub']);
  });
});