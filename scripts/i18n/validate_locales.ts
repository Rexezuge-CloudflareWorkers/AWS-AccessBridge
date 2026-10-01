#!/usr/bin/env node

/**
 * Validate all web locale bundles: JSON-valid, key parity with `en` (no missing
 * and no extra keys), `{{placeholder}}` parity, and no empty values.
 *
 * Key order is deliberately not checked. Locale files are maintained by
 * mirroring new keys into 12 files, and failing on order would turn an
 * otherwise-correct translation update into a CI failure about formatting.
 *
 * Run with `pnpm run validate:locales`. TypeScript rather than `.mjs` so the
 * script is covered by the repo's lint and typecheck rules.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCALES_DIR = path.join(ROOT, 'apps', 'web', 'src', 'locales');

/**
 * Matches one `{{name}}` token.
 *
 * `[^{}]` rather than `.*?` so the pattern cannot backtrack across a long
 * translation string looking for a closing brace that is not there.
 */
const PLACEHOLDER = /\{\{[^{}]+\}\}/g;

/**
 * Collects failures rather than exiting on the first, so one run reports them all.
 */
const failures: string[] = [];

/**
 * Flattens a nested translation object into dotted keys.
 */
function flatten(node: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`expected an object, found ${Array.isArray(node) ? 'an array' : typeof node} at ${prefix || '<root>'}`);
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flatten(value, keyPath, out);
    } else {
      out.set(keyPath, value);
    }
  }
  return out;
}

/**
 * The distinct `{{placeholder}}` tokens in a value, sorted for comparison.
 */
function placeholdersOf(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const matches = value.match(PLACEHOLDER) ?? [];
  return Array.from(new Set(matches)).toSorted((a, b) => a.localeCompare(b));
}

/**
 * Reads and flattens one locale bundle, throwing with the tag on failure.
 */
function readBundle(tag: string): Map<string, unknown> {
  const file = path.join(LOCALES_DIR, tag, 'translation.json');
  return flatten(JSON.parse(readFileSync(file, 'utf8')), '', new Map());
}

const tags = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted((a, b) => a.localeCompare(b));

if (!tags.includes('en')) {
  console.error('FAIL: missing base locale en/translation.json');
  process.exit(1);
}

const en = readBundle('en');
if (en.size === 0) {
  failures.push('en/translation.json is empty');
}

for (const tag of tags) {
  if (tag === 'en') {
    continue;
  }

  let bundle: Map<string, unknown>;
  try {
    bundle = readBundle(tag);
  } catch (error) {
    failures.push(`${tag}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  const missing = en
    .keys()
    .filter((key) => !bundle.has(key))
    .toArray();
  const extra = bundle
    .keys()
    .filter((key) => !en.has(key))
    .toArray();
  const empty = [...bundle].filter(([, value]) => typeof value !== 'string' || value === '').map(([key]) => key);
  const placeholderMismatches = en
    .keys()
    .filter((key) => {
      if (!bundle.has(key)) {
        return false;
      }
      const expected = placeholdersOf(en.get(key));
      const actual = placeholdersOf(bundle.get(key));
      return expected.length !== actual.length || expected.some((token, index) => token !== actual[index]);
    })
    .toArray();

  for (const key of missing) {
    failures.push(`${tag}: missing key ${key}`);
  }
  for (const key of extra) {
    failures.push(`${tag}: extra key ${key} (no en source)`);
  }
  for (const key of empty) {
    failures.push(`${tag}: empty value at ${key}`);
  }
  for (const key of placeholderMismatches) {
    const expected = placeholdersOf(en.get(key)).join(',');
    const actual = placeholdersOf(bundle.get(key)).join(',');
    failures.push(`${tag}: placeholder mismatch at ${key} (en=${expected} vs ${tag}=${actual})`);
  }

  const problems = missing.length + extra.length + empty.length + placeholderMismatches.length;
  const status = problems === 0 ? 'OK' : 'FAIL';
  console.log(
    `${tag}: keys=${bundle.size} missing=${missing.length} extra=${extra.length} empty=${empty.length} ph_mismatch=${placeholderMismatches.length} [${status}]`,
  );
}

for (const message of failures) {
  console.error(`FAIL: ${message}`);
}
console.log(failures.length === 0 ? 'ALL OK' : 'FAILURES PRESENT');
process.exit(failures.length === 0 ? 0 : 1);
