import { describe, expect, it } from 'vitest';
import { isSet, parseFlags, valueOf } from '../../scripts/lib/cli-args';

const SPEC = {
  value: ['db', 'to'],
  boolean: ['dry-run', 'help'],
  alias: { h: 'help' },
} as const;

describe('parseFlags', () => {
  it('reads value flags and boolean switches', () => {
    const flags = parseFlags(['--db', 'bridge', '--to', 'a@b.com', '--dry-run'], SPEC);

    expect(valueOf(flags, 'db')).toBe('bridge');
    expect(valueOf(flags, 'to')).toBe('a@b.com');
    expect(isSet(flags, 'dry-run')).toBe(true);
  });

  it('returns undefined and false for flags that were not supplied', () => {
    const flags = parseFlags([], SPEC);

    expect(valueOf(flags, 'db')).toBeUndefined();
    expect(isSet(flags, 'dry-run')).toBe(false);
  });

  it('resolves a short alias to its long name', () => {
    expect(isSet(parseFlags(['-h'], SPEC), 'help')).toBe(true);
  });

  it('rejects a value flag with no value', () => {
    expect(() => parseFlags(['--to'], SPEC)).toThrow('--to requires a value');
  });

  it('rejects a value flag whose value is the next flag', () => {
    // Without this the flag parser would consume `--dry-run` as the address.
    expect(() => parseFlags(['--to', '--dry-run'], SPEC)).toThrow('--to requires a value');
  });

  it('rejects an unknown flag by name', () => {
    expect(() => parseFlags(['--tpo', 'a@b.com'], SPEC)).toThrow('Unknown argument: --tpo');
  });

  it('rejects a repeated flag rather than taking the last one', () => {
    // Silently winning-by-last-wins would let a stale `--to` be overridden by a
    // later one in a shell pipeline the operator did not inspect.
    expect(() => parseFlags(['--to', 'a@b.com', '--to', 'c@d.com'], SPEC)).toThrow('--to was given more than once');
  });

  it('rejects a bare positional argument', () => {
    expect(() => parseFlags(['stray'], SPEC)).toThrow('Unexpected argument: stray');
  });
});
