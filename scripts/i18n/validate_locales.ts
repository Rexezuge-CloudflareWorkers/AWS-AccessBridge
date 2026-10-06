#!/usr/bin/env tsx

/**
 * Validate the web locale bundles: JSON-valid, key parity with `en` in both
 * directions, `{{placeholder}}` parity, no empty or non-string values, and the
 * three lists of supported tags agreeing with each other.
 *
 * `en` is checked for empty values like every other bundle. It is the fallback
 * for every missing key and the file new keys are added to first, so an empty
 * value there is the one defect that reaches the most users — and the reason
 * every call site passes an English default to `t()`, which makes `''`
 * indistinguishable from a missing key.
 *
 * Key order is deliberately not checked. Locale files are maintained by
 * mirroring new keys into 11 files, and failing on order would turn an
 * otherwise-correct translation update into a CI failure about formatting.
 *
 * Run with `pnpm run validate:locales`. The rules live in `locale-checks.ts` so
 * they are unit tested; this entrypoint only does I/O and reporting. Run through
 * `tsx` rather than `node` because of the extensionless relative import, as every
 * other script that imports a sibling module does.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_LOCALE,
  checkBaseLocale,
  checkBundle,
  checkCallSite,
  checkTagListsAgree,
  checkTags,
  checkUnusedKeys,
  dynamicKeyFinding,
  flatten,
  hasDynamicCall,
  readDeclaredTags,
  translationCalls,
  type Finding,
} from './locale-checks';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCALES_DIR = path.join(ROOT, 'apps', 'web', 'src', 'locales');
const WEB_SRC = path.join(ROOT, 'apps', 'web', 'src');
const WEB_I18N = path.join(WEB_SRC, 'i18n.ts');
const SHARED_LOCALE_UTIL = path.join(ROOT, 'packages', 'shared', 'src', 'utils', 'LocaleUtil.ts');

/**
 * Collects failures rather than exiting on the first, so one run reports them all.
 */
const failures: Finding[] = [];

/**
 * The per-tag tallies printed in the summary line.
 */
interface Counts {
  missing: number;
  extra: number;
  empty: number;
  placeholder: number;
}

/**
 * The locale tags that have a directory, in apply order.
 */
const onDisk = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted((left, right) => left.localeCompare(right));

/**
 * Reads and flattens one bundle. A throw here is a finding, not a crash: one
 * unreadable file should not hide the state of the other eleven.
 */
function readBundle(tag: string): ReturnType<typeof flatten> {
  return flatten(JSON.parse(readFileSync(path.join(LOCALES_DIR, tag, 'translation.json'), 'utf8')));
}

if (!onDisk.includes(BASE_LOCALE)) {
  console.error(`FAIL: missing base locale ${BASE_LOCALE}/translation.json`);
  process.exit(1);
}

const base = readBundle(BASE_LOCALE);
const baseFindings = checkBaseLocale(BASE_LOCALE, base);
failures.push(...baseFindings);

// An empty base locale would make all 306 keys of every other bundle look like
// extras, burying the one finding that matters under 3000 lines of noise. `en` is
// the source every bundle is compared against, so there is nothing to compare to.
if (baseFindings.some((finding) => finding.kind === 'no-base-locale')) {
  for (const finding of baseFindings) {
    console.error(`FAIL: ${finding.subject} ${finding.detail}`);
  }
  console.log('FAILURES PRESENT');
  process.exit(1);
}

for (const tag of onDisk) {
  if (tag === BASE_LOCALE) {
    // Already checked above, and comparing it to itself would report every key as
    // a mismatch.
    console.log(`${tag}: keys=${base.size} [base]`);
    continue;
  }

  let bundle: ReturnType<typeof flatten>;
  try {
    bundle = readBundle(tag);
  } catch (error) {
    failures.push({ kind: 'malformed', subject: tag, detail: error instanceof Error ? error.message : String(error) });
    console.log(`${tag}: [UNREADABLE]`);
    continue;
  }

  const findings = checkBundle(tag, base, bundle);
  failures.push(...findings);

  // Tallyed through a lookup rather than a `switch`, so a new finding kind
  // cannot be added to the module and silently omitted from this summary.
  const COUNTED: Readonly<Record<string, keyof Counts | undefined>> = {
    missing: 'missing',
    extra: 'extra',
    empty: 'empty',
    placeholder: 'placeholder',
  };
  const counts: Counts = { missing: 0, extra: 0, empty: 0, placeholder: 0 };
  for (const finding of findings) {
    const field = COUNTED[finding.kind];
    if (field !== undefined) {
      counts[field] += 1;
    }
  }
  console.log(
    `${tag}: keys=${bundle.size} missing=${counts.missing} extra=${counts.extra} empty=${counts.empty} ph_mismatch=${counts.placeholder} [${findings.length === 0 ? 'OK' : 'FAIL'}]`,
  );
}

// The declared tag lists are read from source text, not imported:
// `apps/web/src/i18n.ts` calls `import.meta.glob`, which only exists after Vite's
// transform, so the module cannot be loaded outside a bundler.
const declared: Record<string, string[]> = {};
for (const [label, file] of [
  ['SUPPORTED_LANGUAGES', WEB_I18N],
  ['SUPPORTED_LOCALES', SHARED_LOCALE_UTIL],
] as const) {
  try {
    const tags = readDeclaredTags(readFileSync(file, 'utf8'), path.relative(ROOT, file));
    declared[label] = tags;
    if (label === 'SUPPORTED_LANGUAGES') {
      failures.push(...checkTags(tags, onDisk));
    }
  } catch (error) {
    declared[label] = [];
    failures.push({ kind: 'malformed', subject: label, detail: error instanceof Error ? error.message : String(error) });
  }
}

failures.push(...checkTagListsAgree(declared.SUPPORTED_LANGUAGES ?? [], declared.SUPPORTED_LOCALES ?? []));

// --- Call sites against the base bundle ---
//
// Everything above compares bundles to each other, so a key missing from *all*
// of them passes. This reads the application instead, which is the only thing
// that can tell a key nobody has from a key nobody wants.
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'locales' || entry === 'generated') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const usedKeys = new Set<string>();
const dynamicSites = new Set<string>();
let defaultsCompared = 0;

for (const file of sourceFiles(WEB_SRC)) {
  const source = readFileSync(file, 'utf8');
  const where = path.relative(ROOT, file);

  for (const call of translationCalls(source)) {
    usedKeys.add(call.key);
    if (call.inlineDefault !== null) defaultsCompared += 1;
    failures.push(...checkCallSite(where, call, base));
  }

  // A key assembled at runtime cannot be verified, so it is named rather than
  // passed over — the script should not report coverage it does not have.
  if (hasDynamicCall(source)) {
    dynamicSites.add(where);
  }
}

const unused = checkUnusedKeys(base, usedKeys);
failures.push(...unused);
for (const where of dynamicSites) {
  failures.push(dynamicKeyFinding(where));
}

console.log(
  `call sites: referenced=${usedKeys.size} unused=${unused.length} dynamic=${dynamicSites.size} defaults_compared=${defaultsCompared} [${dynamicSites.size === 0 ? 'OK' : 'UNVERIFIED'}]`,
);

for (const finding of failures) {
  // Advisory findings describe a limit of this script or untidiness in the
  // bundle, not a defect that should block a merge.
  if (finding.advisory) {
    console.warn(`WARN: ${finding.subject} ${finding.detail}`);
    continue;
  }
  console.error(`FAIL: ${finding.subject} ${finding.detail}`);
}

const fatal = failures.filter((finding) => !finding.advisory);
console.log(fatal.length === 0 ? 'ALL OK' : `FAILURES PRESENT (${fatal.length})`);
process.exit(fatal.length === 0 ? 0 : 1);
