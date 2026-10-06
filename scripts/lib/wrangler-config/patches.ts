import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { CONFIG_PATH, TEMPLATE_PATH, type WranglerConfig } from './types';

/**
 * Reads `wrangler.jsonc` as both text and parsed object.
 *
 * The text is returned alongside because every write goes through
 * `jsonc-parser.modify`, which rewrites only the targeted nodes and preserves
 * the comments and formatting the file is written with.
 */
export function readConfig(): { content: string; config: WranglerConfig } {
  const content = readFileSync(CONFIG_PATH, 'utf8');
  return { content, config: parse(content) as WranglerConfig };
}

/**
 * Applies one edit to `wrangler.jsonc`'s text, leaving the rest byte-identical.
 */
export function writeConfigValue(content: string, path: Array<string | number>, value: unknown): string {
  const edits = modify(content, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } });
  return applyEdits(content, edits);
}

/**
 * Parses `WRANGLER_PATCH_JSON`, requiring a JSON object.
 */
export function parseTopLevelPatch(): Record<string, unknown> | undefined {
  const rawPatch = process.env.WRANGLER_PATCH_JSON;
  if (!rawPatch?.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPatch) as unknown;
  } catch {
    throw new TypeError('WRANGLER_PATCH_JSON must be a valid JSON object.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('WRANGLER_PATCH_JSON must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

/**
 * Merges `WRANGLER_PATCH_JSON` into the top level of `wrangler.jsonc`.
 */
export function applyTopLevelPatch(): void {
  const patch = parseTopLevelPatch();
  const patchEntries = Object.entries(patch ?? {});
  if (patchEntries.length === 0) {
    return;
  }

  let { content } = readConfig();

  for (const [key, value] of patchEntries) {
    content = writeConfigValue(content, [key], value);
  }

  writeFileSync(CONFIG_PATH, content.endsWith('\n') ? content : `${content}\n`);
  console.log(`Applied ${patchEntries.length} Wrangler top-level patch entr${patchEntries.length === 1 ? 'y' : 'ies'}.`);
}

/**
 * Parses `WRANGLER_VARS_PATCH_JSON`, requiring a JSON object of string values.
 */
export function parseVarsPatch(): Record<string, string> | undefined {
  const rawPatch = process.env.WRANGLER_VARS_PATCH_JSON;
  if (!rawPatch?.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPatch) as unknown;
  } catch {
    throw new TypeError('WRANGLER_VARS_PATCH_JSON must be a valid JSON object of string values.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('WRANGLER_VARS_PATCH_JSON must be a JSON object of string values.');
  }

  // Values are rejected rather than coerced: a boolean or number reaching
  // `wrangler.jsonc` as a non-string would silently deploy a different value
  // than the caller wrote.
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim()) {
      throw new TypeError('WRANGLER_VARS_PATCH_JSON contains an empty variable name.');
    }
    if (typeof value !== 'string') {
      throw new TypeError(`WRANGLER_VARS_PATCH_JSON value for ${key} must be a string.`);
    }
    patch[key] = value;
  }

  return patch;
}

/**
 * Materializes `wrangler.jsonc` from the repository variable, or from the
 * committed template when no override is set.
 */
export function prepareConfigFile(): void {
  const dumpedConfig = process.env.WRANGLER_JSONC;
  if (dumpedConfig?.trim()) {
    writeFileSync(CONFIG_PATH, dumpedConfig.endsWith('\n') ? dumpedConfig : `${dumpedConfig}\n`);
    console.log('Wrote wrangler.jsonc from WRANGLER_JSONC repository variable.');
    return;
  }

  copyFileSync(TEMPLATE_PATH, CONFIG_PATH);
  console.log('WRANGLER_JSONC is empty; copied apps/api/wrangler.template.jsonc to wrangler.jsonc.');
}

/**
 * Merges `WRANGLER_VARS_PATCH_JSON` into `wrangler.jsonc`'s `vars` section.
 */
export function applyVarsPatch(): void {
  const patch = parseVarsPatch();
  const patchEntries = Object.entries(patch ?? {});
  if (patchEntries.length === 0) {
    return;
  }

  const preparedConfig = readConfig();
  let content = preparedConfig.content;
  const { config } = preparedConfig;
  // `vars: null` must be rejected rather than read as absent, or `modify` would
  // fail on a null parent instead of reporting the config as invalid.
  if (config.vars !== undefined && (config.vars === null || typeof config.vars !== 'object' || Array.isArray(config.vars))) {
    throw new TypeError('wrangler.jsonc vars must be an object before applying WRANGLER_VARS_PATCH_JSON.');
  }

  if (!config.vars) {
    content = writeConfigValue(content, ['vars'], {});
  }

  for (const [key, value] of patchEntries) {
    content = writeConfigValue(content, ['vars', key], value);
  }

  writeFileSync(CONFIG_PATH, content.endsWith('\n') ? content : `${content}\n`);
  console.log(`Applied ${patchEntries.length} Wrangler vars patch entr${patchEntries.length === 1 ? 'y' : 'ies'}.`);
}
