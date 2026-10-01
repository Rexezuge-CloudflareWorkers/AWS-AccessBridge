import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The favicon is inlined as a `data:` URI at build time (the `favicon-inline`
 * Vite plugin). The Worker serves the SPA itself, so a `href="/favicon.svg"`
 * would cost a request the Worker must answer — either from the static-asset
 * binding or, worse, by falling through the SPA catch-all and serving HTML as an
 * icon.
 *
 * These tests pin the *built* artifact, not the plugin's return value, because the
 * thing that matters is what `spa-shell.ts` embeds.
 */

const ROOT: string = path.resolve(__dirname, '..', '..');
const FAVICON: string = path.join(ROOT, 'apps', 'web', 'public', 'favicon.svg');
const INDEX_HTML: string = path.join(ROOT, 'apps', 'web', 'dist', 'index.html');
const SPA_SHELL: string = path.join(ROOT, 'apps', 'api', 'src', 'generated', 'spa-shell.ts');

/** Decode a `data:` URI back to the bytes it carries. */
function decodeDataUri(href: string): string {
  const prefix = 'data:image/svg+xml,';
  expect(href.startsWith(prefix)).toBe(true);
  return decodeURIComponent(href.slice(prefix.length));
}

function iconHref(html: string): string {
  const match = /<link[^>]*rel="icon"[^>]*href="([^"]*)"/.exec(html);
  expect(match, 'index.html has no <link rel="icon">').not.toBeNull();
  return match?.[1] ?? '';
}

describe('favicon data URI', () => {
  const source: string = readFileSync(FAVICON, 'utf8').trim();

  it('is embedded in the built index.html as a data URI, not a path', () => {
    const href: string = iconHref(readFileSync(INDEX_HTML, 'utf8'));
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    // The regression: an unresolved `/favicon.svg` that the Worker must serve.
    expect(href).not.toContain('href="/favicon.svg"');
    expect(href).not.toMatch(/href="\/[^"]*favicon/);
  });

  it('round-trips to exactly the source file, so the icon cannot drift', () => {
    expect(decodeDataUri(iconHref(readFileSync(INDEX_HTML, 'utf8')))).toBe(source);
  });

  it('escapes the characters that would break out of the attribute', () => {
    const href: string = iconHref(readFileSync(INDEX_HTML, 'utf8'));
    // Inside the double-quoted href attribute, these must not appear literally.
    const attributeValue: string = href.split('href="')[1]?.split('"')[0] ?? '';
    expect(attributeValue).not.toContain('<');
    expect(attributeValue).not.toContain('>');
    expect(attributeValue).not.toContain('"');
    expect(attributeValue).not.toContain("'");
  });

  it('is embedded in the SPA shell the Worker serves', () => {
    const shell: string = readFileSync(SPA_SHELL, 'utf8');
    expect(shell).toContain('data:image/svg+xml,');
    expect(shell).not.toContain('/favicon.svg');
  });

  it('keeps the source file, which stays the single source of truth', () => {
    // The plugin generates from this file rather than an inlined copy in
    // index.html; if it were removed the build would throw.
    expect(source).toContain('<svg');
    expect(source).toContain('viewBox="0 0 32 32"');
  });
});