/**
 * The favicon inline transform, as a pure function.
 *
 * Kept out of `vite.config.ts` so it is unit-testable: the plugin's behaviour is
 * only observable through a Vite build, and `apps/web/dist/**` does not exist
 * until one runs — so a test asserting on build output fails on a fresh checkout.
 * Testing the transform directly means the `data:` URI contract is covered by the
 * unit suite, which runs before (and independently of) the `build-web` CI job.
 */

/**
The MIME type every inlined icon uses. Matches the `type` on the `<link>`.
*/
const FAVICON_MIME: string = 'image/svg+xml';

/**
 * The `<link>` this module produces. Replaces whatever placeholder it is given.
 *
 * Attribute order is not fixed in the source, so `rel` is matched anywhere inside
 * the tag rather than at an assumed position. The trailing `/?>` covers both the
 * self-closing and the bare form.
 */
const ICON_LINK_PATTERN: RegExp = /<link[^>]*rel=["']icon["'][^>]*>/;

/**
 * Encode an SVG as a `data:` URI.
 *
 * `encodeURIComponent` already escapes everything that could break out of a
 * double-quoted HTML attribute. `#` and `%` are deliberately **not** escaped
 * further: they are the data URI's own escape mechanism, so rewriting them would
 * corrupt the payload.
 */
function toFaviconDataUri(svg: string): string {
  return `data:${FAVICON_MIME},${encodeURIComponent(svg.trim())}`;
}

/**
 * Replace the `<link rel="icon">` in an HTML document with an inlined `data:` URI.
 *
 * The Worker serves the SPA itself, so `href="/favicon.svg"` costs a request the
 * Worker must answer — either from the static-asset binding or, worse, by falling
 * through the SPA catch-all and returning a page of HTML as an icon.
 *
 * Generated from `public/favicon.svg` on every build rather than pasted into
 * `index.html`, so the icon cannot drift from the file it is meant to be: a
 * hand-written data URI in `index.html` would be silently overwritten here.
 *
 * Throws when there is no `<link rel="icon">` to replace. Silently returning the
 * input would ship a broken icon, and the only symptom would be a 404 in the
 * browser console on a deploy that otherwise looked fine.
 */
function inlineFaviconInto(html: string, svg: string): string {
  const link: string = `<link rel="icon" type="${FAVICON_MIME}" href="${toFaviconDataUri(svg)}" />`;
  // A replacer function, not a string: `$&` and friends inside the data URI would
  // otherwise be interpreted as replacement patterns.
  const replaced: string = html.replace(ICON_LINK_PATTERN, () => link);
  if (replaced === html) {
    throw new Error('inlineFavicon: no <link rel="icon"> found in index.html to inline.');
  }
  return replaced;
}

export { toFaviconDataUri, inlineFaviconInto };

