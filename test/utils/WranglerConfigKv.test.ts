import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { ensureRequiredKvBindings, getRequiredKvBindings } from '../../scripts/prepare-wrangler-config';

const PLACEHOLDER_ID = '00000000000000000000000000000000';

describe('ensureRequiredKvBindings', () => {
  it('requires the AccessBridgeKV binding', () => {
    expect(getRequiredKvBindings()).toContain('AccessBridgeKV');
  });

  it('injects kv_namespaces when the section is missing', () => {
    const content = JSON.stringify({ name: 'aws-access-bridge' }, null, 2);
    const output = ensureRequiredKvBindings(content, parse(content));
    const config = parse(output) as { kv_namespaces?: Array<{ binding?: string; id?: string }> };
    expect(config.kv_namespaces).toEqual([{ binding: 'AccessBridgeKV', id: PLACEHOLDER_ID }]);
  });

  it('appends the missing binding while preserving existing entries', () => {
    const content = JSON.stringify({ kv_namespaces: [{ binding: 'OTHER', id: 'abc' }] }, null, 2);
    const output = ensureRequiredKvBindings(content, parse(content));
    const config = parse(output) as { kv_namespaces?: Array<{ binding?: string; id?: string }> };
    expect(config.kv_namespaces).toEqual([
      { binding: 'OTHER', id: 'abc' },
      { binding: 'AccessBridgeKV', id: PLACEHOLDER_ID },
    ]);
  });

  it('leaves configs with a provisioned entry untouched', () => {
    const content = JSON.stringify({ kv_namespaces: [{ binding: 'AccessBridgeKV', id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' }] }, null, 2);
    expect(ensureRequiredKvBindings(content, parse(content))).toBe(content);
  });
});
