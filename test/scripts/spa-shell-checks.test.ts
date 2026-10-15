import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkShell,
  checkCss,
  KIT_REQUIRED_CSS_TOKENS,
  MIN_HTML_BYTES,
  readEmbeddedHtml,
  referencedAssets,
  SPA_HTML_MARKER,
} from '../../scripts/build/spa-shell-checks';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every file Tailwind's automatic source detection can read for the SPA.
 *
 * Its scan root is the Vite root, `apps/web`, and it reads any text file there
 * *except* what `.gitignore` excludes — so Markdown and config files are candidates
 * alongside JSX, and `node_modules` and `dist` are not. Walking this set is what
 * makes "this token can only come from the kit" a checked statement.
 */
function readAppWeb(): Array<{ file: string; text: string }> {
  const skip = new Set(['node_modules', 'dist']);
  const found: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.push({ file: path.relative(REPO_ROOT, full), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(REPO_ROOT, 'apps/web'));
  return found;
}

/**
 * Which of `tokens` some file under the scan root already names.
 *
 * What disqualifies a token is a *class name*, which the scanner reads as a
 * candidate and Tailwind then emits. Three ways a file can carry one, all checked:
 *
 * - as a JSX `className` / `class` attribute value, in source or in Markdown;
 * - inside a `cn(...)`, template literal or quoted string — anywhere a class can sit;
 * - as a *selector*, i.e. with a leading `.` and a brace after it.
 *
 * Two things deliberately do **not** count. A theme variable
 * (`--animate-backdrop-in: backdrop-in 0.2s …`, declared in this app's own `@theme`
 * block) shares a token's text but emits no utility, so it cannot satisfy the gate and
 * must not be reported as an offender. Nor does prose without a leading `.`: the
 * scanner ignores `*`, and Tailwind escapes `:` inside a selector, so the shipped
 * form of a variant utility carries no bare unescaped colon either. The gate's own
 * prose in `apps/web/AGENTS.md` is therefore fine — it names the controls, not the
 * utilities.
 */
function tokensNamedUnder(files: Array<{ file: string; text: string }>, tokens: readonly string[]): string[] {
  const named = (text: string, token: string): boolean => {
    const classAttribute = /(?:className|class)\s*=\s*["'`]([^"'`]*)/g;
    for (const attribute of text.matchAll(classAttribute)) {
      if ((attribute[1] ?? '').includes(token)) return true;
    }
    const quoted = /["'`]([^"'`]+)["'`]/g;
    for (const value of text.matchAll(quoted)) {
      if ((value[1] ?? '').includes(token)) return true;
    }
    return new RegExp(String.raw`\.${token.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\s*[,{]`).test(text);
  };
  return tokens.filter((token) => files.some(({ text }) => named(text, token)));
}

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
    expect(problems.map((problem) => problem.code).toSorted((left, right) => left.localeCompare(right))).toEqual([
      'dist-missing',
      'missing-asset',
    ]);
  });

  it('does not check assets against a shell it could not decode', () => {
    // Reporting "references no assets" for an unreadable shell would name the wrong
    // thing and send an operator to rebuild for no reason.
    const problems = checkShell(`${SPA_HTML_MARKER}'';`, null, has([]));
    expect(problems.map((problem) => problem.code)).toEqual(['stub']);
  });
});

describe('checkCss', () => {
  /**
   * A bundle that really carries every token, in Tailwind's emitted selector form.
   */
  const fullBundle = () => KIT_REQUIRED_CSS_TOKENS.map((token) => `.${token}{color:red}`).join('\n');

  it('passes when every kit utility is present as a selector', () => {
    expect(checkCss(fullBundle())).toHaveLength(0);
  });

  it('reads a token out of the Tailwind escape form', () => {
    // What Vite actually writes for an arbitrary-value utility: the brackets, the
    // parens and the var() are all backslash-escaped inside the selector. Neither may
    // be reported as missing, or the gate would fail on a correct build.
    const bundle = String.raw`.animate-spin{animation:var(--animate-spin)}.bg-\[var\(--color-accent\)\]{background-color:var(--color-accent)}`;
    const detail = checkCss(bundle)[0]?.detail ?? '';
    expect(detail).not.toContain('animate-spin');
    expect(detail).not.toContain('bg-[var(--color-accent)]');
  });

  it('does not accept a theme variable in place of a utility', () => {
    // The bug this guards: Tailwind emits `--animate-spin` from its default theme
    // whether or not any component uses it, so a substring match calls a frozen
    // spinner present. Only a `.`-prefixed selector counts.
    const problems = checkCss(':root{--animate-spin:spin 1s linear infinite}');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain('animate-spin');
  });

  it('reports the missing token names', () => {
    const omitted = KIT_REQUIRED_CSS_TOKENS[0];
    const css = KIT_REQUIRED_CSS_TOKENS.filter((token) => token !== omitted)
      .map((token) => `.${token}{color:red}`)
      .join('\n');
    const problems = checkCss(css);
    expect(problems.map((problem) => problem.code)).toEqual(['missing-tailwind-utility']);
    expect(problems[0]?.detail).toContain(omitted);
    expect(problems[0]?.detail).toContain('@source');
  });

  it('names a missing bundle `missing-css`', () => {
    expect(checkCss(null).map((problem) => problem.code)).toEqual(['missing-css']);
  });

  it('has no token this repository itself writes into the scan root', () => {
    // Tailwind's scan root is `apps/web/**` and it reads Markdown as readily as JSX, so
    // a token named anywhere under there is compiled into the bundle whether or not the
    // kit is a source — and this gate would pass with the `@source` line deleted. Four
    // of the original eight were named by `apps/web/AGENTS.md`, the spinner's included,
    // so the gate was reporting success on the regression it exists to catch. A doc edit
    // must not be able to disarm it silently.
    expect(tokensNamedUnder(readAppWeb(), KIT_REQUIRED_CSS_TOKENS)).toEqual([]);
  });
});
