import { describe, it, expect, vi } from 'vitest';
import { AuditPayloadBuilder } from '@aws-access-bridge/backend-services/audit/AuditPayloadBuilder';
import { AuditObserverRegistry } from '@aws-access-bridge/backend-services/audit/AuditObserverRegistry';
import { AuditService } from '@aws-access-bridge/backend-services/audit/AuditService';

describe('AuditPayloadBuilder', () => {
  it('resolves known actions and falls back to method:path', () => {
    expect(AuditPayloadBuilder.resolveAction('POST', '/user/aws/assume-role')).toBe('ASSUME_ROLE');
    expect(AuditPayloadBuilder.resolveAction('DELETE', '/user/nope')).toBe('DELETE:/user/nope');
  });

  it('builds events from requests with network context', () => {
    const request = new Request('https://example.com/user/aws/assume-role', {
      method: 'POST',
      headers: { 'User-Agent': 'vitest' },
    });
    const event = AuditPayloadBuilder.fromRequest(request, 'user@example.com', 200, {});
    expect(event).toMatchObject({ userEmail: 'user@example.com', action: 'ASSUME_ROLE', method: 'POST', statusCode: 200 });
    expect(event.logId).toBeTruthy();
  });
});

describe('AuditObserverRegistry', () => {
  it('fans out via allSettled and isolates failures', async () => {
    const ok = { notify: vi.fn().mockResolvedValue(undefined) };
    const failing = { notify: vi.fn().mockRejectedValue(new Error('sink down')) };
    const registry = AuditObserverRegistry.withObservers([ok, failing]);
    const results = await registry.notifyAll({ action: 'X' } as never);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(ok.notify).toHaveBeenCalledOnce();
  });
});

describe('AuditService over registry', () => {
  it('records through injected observers without D1', async () => {
    const observer = { notify: vi.fn().mockResolvedValue(undefined) };
    const service = new AuditService({ AccessBridgeDB: {} } as never, [observer]);
    await service.record({ action: 'TEST' } as never);
    expect(observer.notify).toHaveBeenCalledOnce();
    expect(AuditService.resolveAction('POST', '/user/aws/assume-role')).toBe('ASSUME_ROLE');
  });
});
