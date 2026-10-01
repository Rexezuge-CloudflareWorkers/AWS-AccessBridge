import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies every observer even when one fails', async () => {
    const ok = { notify: vi.fn().mockResolvedValue(undefined) };
    const failing = { notify: vi.fn().mockRejectedValue(new Error('sink down')) };
    const registry = AuditObserverRegistry.withObservers([ok, failing]);
    await registry.notifyAll({ action: 'X' } as never);
    // `allSettled`, so a failing sink cannot stop the others recording.
    expect(ok.notify).toHaveBeenCalledOnce();
    expect(failing.notify).toHaveBeenCalledOnce();
  });

  it('does not reject, so an audit failure cannot fail the request', async () => {
    const failing = { notify: vi.fn().mockRejectedValue(new Error('D1 is busy')) };
    await expect(AuditObserverRegistry.withObservers([failing]).notifyAll({ action: 'X' } as never)).resolves.toBeUndefined();
  });

  it('logs a failure that would otherwise vanish', async () => {
    // Regression: `notifyAll` used to *return* the `allSettled` results and
    // `AuditService.record` discarded them, so every rejected `AuditLogDAO.create`
    // disappeared with no log at all — a governance control failing silently.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await AuditObserverRegistry.withObservers([{ notify: vi.fn().mockRejectedValue(new Error('D1 is busy')) }]).notifyAll({ action: 'X' } as never);
    expect(logged.mock.calls.flat().join(' ')).toContain('D1 is busy');
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
