/**
 * Minimal flag parsing for the operator scripts.
 *
 * `change-email.ts` is the only current caller, but the shape is generic: a
 * declared set of value flags and boolean flags, so an unknown or valueless flag
 * is rejected by name rather than silently ignored. A typo in a `--to` address
 * must not degrade into "the flag was empty".
 */

/**
 * Parsed flags: value flags map to their string, boolean flags to `true`.
 */
export type ParsedFlags = Map<string, string | true>;

/**
 * Declares which flags take a value and which are bare switches.
 */
export interface FlagSpec {
  /**
   * `--name` takes a value, e.g. `--to new@example.com`.
   */
  value?: readonly string[];
  /**
   * `--dry-run` takes no value.
   */
  boolean?: readonly string[];
  /**
   * Short form → long form, e.g. `{ h: 'help' }`.
   */
  alias?: Readonly<Record<string, string>>;
}

/**
 * Parses `--flag value` and `--boolean` pairs out of `argv`.
 *
 * @throws when a value flag is missing its value, when a flag is repeated, or
 *   when an undeclared flag is seen. Each case names the offending flag.
 */
export function parseFlags(argv: readonly string[], spec: FlagSpec): ParsedFlags {
  const valueFlags = new Set(spec.value);
  const booleanFlags = new Set(spec.boolean);
  const aliases = spec.alias ?? {};
  const flags: ParsedFlags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const raw = arg.replace(/^--?/, '');
    const name = aliases[raw] ?? raw;

    if (booleanFlags.has(name)) {
      if (flags.has(name)) {
        throw new Error(`--${name} was given more than once`);
      }
      flags.set(name, true);
      continue;
    }

    if (!valueFlags.has(name)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (flags.has(name)) {
      throw new Error(`--${name} was given more than once`);
    }

    const value = argv[index + 1];
    // A value that starts with `-` is treated as a missing value so that
    // `--to --dry-run` reports the real problem instead of capturing the flag.
    if (value === undefined || value.startsWith('-')) {
      throw new Error(`--${name} requires a value`);
    }
    flags.set(name, value);
    index += 1;
  }

  return flags;
}

/**
 * Reads a value flag, or `undefined` when it was not supplied.
 */
export function valueOf(flags: ParsedFlags, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads a boolean flag, defaulting to `false`.
 */
export function isSet(flags: ParsedFlags, name: string): boolean {
  return flags.get(name) === true;
}
