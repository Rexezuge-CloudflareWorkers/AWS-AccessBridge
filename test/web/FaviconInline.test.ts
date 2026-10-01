import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toFaviconDataUri, inlineFaviconInto } from '../../apps/web/inlineFavicon';

/**
 * The favicon is inlined as a `data:` URI at build time. The Worker serves the SPA
 * itself, so a `href="/favicon.svg"` would cost a request the Worker must answer —
 * either from the static-asset binding or, worse, by falling through the SPA
 * catch-all and returning a page of HTML as an icon.
 *
 * These exercise the transform against the *real* `index.html` and
 * `public/favicon.svg`. An earlier version asserted on `apps/web/dist/index.html`
 * and the generated `spa-shell.ts`; neither exists until a Vite build runs, so it
 * failed on a fresh checkout — the `unit-tests` CI job runs before, and
 * independently of, `build-web`.
 */

const WEB: string = path.resolve(__dirname, '..', '..', 'apps', 'web');
const FAVICON: string = path.join(WEB, 'public', 'favicon.svg');
const INDEX_HTML: string = path.join(WEB, 'index.html');

const SVG: string = readFileSync(FAVICON, 'utf8').trim();
const INDEX: string = readFileSync(INDEX_HTML, 'utf8');

/** The `href` of the first `<link rel="icon">` in a document. */
function iconHref(html: string): string {
  const match: RegExpExecArray | null = /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']*)["']/.exec(html);
  expect(match, 'no <link rel="icon" href="…"> found').not.toBeNull();
  return match?.[1] ?? '';
}

/** Decode a `data:` URI back to the text it carries. */
function decodeDataUri(href: string): string {
  const prefix = 'data:image/svg+xml,';
  expect(href.startsWith(prefix)).toBe(true);
  return decodeURIComponent(href.slice(prefix.length));
}

describe('favicon data URI', () => {
  it('replaces the real index.html placeholder with a data URI, not a path', () => {
    const href: string = iconHref(inlineFaviconInto(INDEX, SVG));
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    // The regression: an unresolved `/favicon.svg` the Worker would have to serve.
    expect(href).not.toContain('favicon.svg');
  });

  it('round-trips to exactly the source file, so the icon cannot drift', () => {
    // The point of generating the URI from `public/favicon.svg` rather than
    // pasting one into `index.html`: two hand-maintained copies drift, one
    // generated copy cannot.
    expect(decodeDataUri(iconHref(inlineFaviconInto(INDEX, SVG)))).toBe(SVG);
  });

  it('escapes the characters that would break out of the href attribute', () => {
    const hostile = '<svg><script>alert("x")</script></svg>';
    const html: string = inlineFaviconInto(INDEX, hostile);
    const href: string = iconHref(html);
    // Nothing may terminate the double-quoted attribute early.
    expect(href).not.toContain('"');
    expect(href).not.toContain("'");
    // ...nor open a tag.
    expect(href).not.toContain('<');
    expect(href).not.toContain('>');
    // ...and the payload still round-trips, so escaping is lossless.
    expect(decodeDataUri(href)).toBe(hostile);
  });

  it('leaves the rest of the document untouched', () => {
    const html: string = inlineFaviconInto(INDEX, SVG);
    // Only the one link differs.
    expect(html.replace(iconHref(html), '')).toBe(INDEX.replace(iconHref(INDEX), ''));
  });

  it('keeps the SVG as the declared type', () => {
    const html: string = inlineFaviconInto(INDEX, SVG);
    expect(html).toContain('type="image/svg+xml"');
  });

  it('fails the build rather than shipping an icon-less page', () => {
    // Silently returning the input would leave a 404 in the browser console on a
    // deploy that otherwise looked fine.
    expect(() => inlineFaviconInto('<html><head></head></html>', SVG)).toThrow(/no <link rel="icon">/);
  });
});

describe('toFaviconDataUri', () => {
  it('prefixes the SVG mime type', () => {
    expect(toFaviconDataUri('<svg/>')).toBe('data:image/svg+xml,%3Csvg%2F%3E');
  });

  it('trims surrounding whitespace so the payload is the file, not the file plus a newline', () => {
    expect(toFaviconDataUri('  <svg/>\n')).toBe(toFaviconDataUri('<svg/>'));
  });

  /**
   * `#` and `%` are the data URI's own escape mechanism. Re-encoding them would
   * corrupt the payload, and `decodeURIComponent` is what proves it.
   */
  it('round-trips a payload full of fragments, percents, and plus signs', () => {
    const awkward = '<svg><style>.a{fill:#ff9900}</style><text>100% &amp; a+b</text></svg>';
    expect(decodeDataUri(toFaviconDataUri(awkward))).toBe(awkward);
  });
});
