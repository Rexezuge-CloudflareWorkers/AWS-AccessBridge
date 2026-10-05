/**
 * The rules behind `scripts/build/verify-spa-shell.ts`.
 *
 * Pure and exported so every check is testable without a build on disk. The
 * filesystem side is three `existsSync` calls and two `readFileSync`, and none of
 * that is where the risk lives — the risk is knowing which of the ways a shell can
 * be wrong to look for.
 */

/**
 * A built shell is a full Vite `index.html`. The `postinstall` stub is
 * `SPA_HTML: string = ''`. Any threshold works; this one only has to reject an
 * obviously empty value.
 */
export const MIN_HTML_BYTES = 200;

/**
 * The prefix the generated module declares `SPA_HTML` with.
 *
 * Exact rather than a regex: the generated file is ours, and matching the literal
 * means a change to the plugin's output shape is reported as "does not export
 * SPA_HTML — regenerate it" instead of decoding whatever now sits in its place.
 */
export const SPA_HTML_MARKER = 'export const SPA_HTML: string = ';

/**
 * What a problem is, and why it matters. A message the operator cannot act on is
 * half a failure: they are looking at a blank page and need to know it is a build
 * they did not run.
 */
export interface ShellProblem {
  readonly code:
    'missing' | 'unexported' | 'stub' | 'malformed' | 'too-small' | 'no-assets' | 'missing-asset' | 'dist-missing' | 'disagreement';
  readonly detail: string;
}

/**
 * The assets the embedded shell references, in document order and deduped.
 *
 * Only same-origin `/assets/` paths count. An absolute URL to another host is not
 * something `apps/web/dist/assets` can be expected to hold, and checking it would
 * report a false problem on a shell that is perfectly correct.
 */
export function referencedAssets(html: string): string[] {
  const found = html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g).map((match) => match[1] as string).toArray();
  return new Set(found).values().toArray();
}

/**
 * Decodes the `SPA_HTML` string literal out of the generated module.
 *
 * Returns the problems rather than the HTML, because every failure here is a
 * distinct operator action and collapsing them into `null` would make the reason a
 * blank page depend on which message happened to be built first.
 */
export function readEmbeddedHtml(source: string): { html: string | null; problems: ShellProblem[] } {
  const at = source.indexOf(SPA_HTML_MARKER);
  if (at === -1) {
    return {
      html: null,
      problems: [
        {
          code: 'unexported',
          detail: `apps/api/src/generated/spa-shell.ts does not export SPA_HTML — regenerate it with \`pnpm run build\`.`,
        },
      ],
    };
  }

  const literal = source
    .slice(at + SPA_HTML_MARKER.length)
    .replace(/;\s*$/, '')
    .trim();

  // The `postinstall` stub is `SPA_HTML: string = ''`, which `JSON.parse` rejects,
  // so it is recognised before the parse rather than reported as malformed. It is the
  // most common failure by far — a fresh clone that never ran `pnpm run build` — and
  // it deserves the actionable message.
  if (literal === "''" || literal === '""') {
    return {
      html: null,
      problems: [
        {
          code: 'stub',
          detail:
            'apps/api/src/generated/spa-shell.ts still holds the empty postinstall stub — run `pnpm run build`. ' +
            'Until then every browser navigation served by the API worker is a blank page.',
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(literal);
  } catch {
    return {
      html: null,
      problems: [
        {
          code: 'malformed',
          detail: 'apps/api/src/generated/spa-shell.ts is not the generated shape — delete it and run `pnpm run build`.',
        },
      ],
    };
  }

  if (typeof parsed !== 'string') {
    return {
      html: null,
      problems: [
        {
          code: 'malformed',
          detail: `apps/api/src/generated/spa-shell.ts holds ${typeof parsed}, not a string — regenerate it with \`pnpm run build\`.`,
        },
      ],
    };
  }

  if (parsed.length < MIN_HTML_BYTES) {
    return {
      html: null,
      problems: [
        {
          code: 'too-small',
          detail:
            `apps/api/src/generated/spa-shell.ts holds no usable HTML (${parsed.length} chars) — run \`pnpm run build\`. ` +
            'Until then every browser navigation served by the API worker is a blank page.',
        },
      ],
    };
  }

  return { html: parsed, problems: [] };
}

/**
 * The problems with a shell, given what is on disk.
 *
 * Three independent failures are all "the build is not what you think it is", and all
 * three are checked: a shell can decode cleanly, reference assets that are absent,
 * and disagree with `dist/index.html` at the same time.
 *
 * @param shellSource the generated module's text, or `null` when it does not exist.
 * @param distIndex the built `index.html`'s text, or `null` when `dist/` does not exist.
 * @param assetExists called per referenced asset name.
 */
export function checkShell(shellSource: string | null, distIndex: string | null, assetExists: (name: string) => boolean): ShellProblem[] {
  if (shellSource === null) {
    return [
      {
        code: 'missing',
        detail: 'apps/api/src/generated/spa-shell.ts is missing — run `pnpm run build` (only apps/web has a build script).',
      },
    ];
  }

  const { html, problems } = readEmbeddedHtml(shellSource);
  if (html === null) {
    return problems;
  }

  // Every same-origin asset the shell references must exist in `dist/assets`. A
  // missing one means the served page loads with no JS, so the operator UI silently
  // renders nothing at all — which is why the asset check cannot be folded into the
  // `dist/index.html` comparison below.
  const assets = referencedAssets(html);
  if (assets.length === 0) {
    // **The load-bearing finding for a fresh clone.** `ensure-spa-shell-stub.ts` writes a
    // complete, plausible-looking page rather than an empty string, so it clears every
    // other check here — it is over `MIN_HTML_BYTES`, it parses, and it is not the `''`
    // stub — and the only thing distinguishing it from a real build is that it references
    // no bundle. Without this it would be deployed as a valid-looking blank page.
    problems.push({
      code: 'no-assets',
      detail:
        'The embedded shell references no /assets/ bundles, so it loads no JavaScript and the page renders its static markup and nothing else. Run `pnpm run build`; a shell without bundles is the `postinstall` stub.',
    });
  }
  for (const asset of assets) {
    if (!assetExists(asset)) {
      problems.push({
        code: 'missing-asset',
        detail: `The embedded shell references /assets/${asset}, which is not in apps/web/dist/assets — run \`pnpm run build\`.`,
      });
    }
  }

  // The Vite plugin writes a verbatim copy of `dist/index.html`, so a disagreement
  // means only one half of the build was refreshed — which reads as "I built it" and
  // is the failure that survives a clean-looking shell.
  if (distIndex === null) {
    problems.push({ code: 'dist-missing', detail: 'apps/web/dist/index.html is missing — run `pnpm run build`.' });
  } else if (distIndex !== html) {
    problems.push({
      code: 'disagreement',
      detail: 'apps/api/src/generated/spa-shell.ts does not match apps/web/dist/index.html — run `pnpm run build`.',
    });
  }

  return problems;
}
