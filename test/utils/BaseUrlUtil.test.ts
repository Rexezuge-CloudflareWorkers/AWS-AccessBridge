import { describe, it, expect } from 'vitest';
import { BaseUrlUtil } from '@aws-access-bridge/backend-services/aws/BaseUrlUtil';
import { InternalServerError } from '@aws-access-bridge/backend-errors';
import {
  CF_CONNECTING_IP_HEADER,
  CF_RAY_HEADER,
  API_WORKER_BASE_HOSTNAME,
  FORWARDED_HOST_HEADER,
  FORWARDED_PROTO_HEADER,
  INTERNAL_BASE_URL_HEADER,
  SELF_WORKER_BASE_HOSTNAME,
} from '@aws-access-bridge/shared/constants';

function withCloudflareMetadata(request: Request): Request {
  Object.defineProperty(request, 'cf', {
    value: { colo: 'SFO' },
    configurable: true,
  });
  return request;
}

describe('BaseUrlUtil', () => {
  describe('getBaseUrl', () => {
    it('returns origin for external requests', () => {
      const request = new Request('https://my-worker.example.com/api/test');
      expect(BaseUrlUtil.getBaseUrl(request)).toBe('https://my-worker.example.com');
    });

    it('returns origin for external requests with port', () => {
      const request = new Request('https://localhost:8787/api/test');
      expect(BaseUrlUtil.getBaseUrl(request)).toBe('https://localhost:8787');
    });

    it('returns forwarded origin for trusted Pages proxy requests', () => {
      const request = withCloudflareMetadata(
        new Request(`https://${API_WORKER_BASE_HOSTNAME}/api/aws/federate`, {
          headers: {
            [CF_CONNECTING_IP_HEADER]: '203.0.113.10',
            [CF_RAY_HEADER]: 'test-ray',
            [FORWARDED_HOST_HEADER]: 'access.example.com',
            [FORWARDED_PROTO_HEADER]: 'https',
          },
        }),
      );

      expect(BaseUrlUtil.getBaseUrl(request)).toBe('https://access.example.com');
    });

    it('ignores spoofed forwarded origin headers on direct requests', () => {
      const request = withCloudflareMetadata(
        new Request('https://worker.example.com/api/test', {
          headers: {
            [CF_CONNECTING_IP_HEADER]: '203.0.113.10',
            [CF_RAY_HEADER]: 'test-ray',
            [FORWARDED_HOST_HEADER]: 'spoofed.example.com',
            [FORWARDED_PROTO_HEADER]: 'https',
          },
        }),
      );

      expect(BaseUrlUtil.getBaseUrl(request)).toBe('https://worker.example.com');
    });

    it('returns internal base URL header for self-worker requests', () => {
      const request = new Request(`https://${SELF_WORKER_BASE_HOSTNAME}/api/test`, {
        headers: { [INTERNAL_BASE_URL_HEADER]: 'https://real-origin.example.com' },
      });
      expect(BaseUrlUtil.getBaseUrl(request)).toBe('https://real-origin.example.com');
    });

    it('throws InternalServerError when self-worker request missing base URL header', () => {
      const request = new Request(`https://${SELF_WORKER_BASE_HOSTNAME}/api/test`);
      expect(() => BaseUrlUtil.getBaseUrl(request)).toThrow(InternalServerError);
      expect(() => BaseUrlUtil.getBaseUrl(request)).toThrow('Internal call missing required base URL header.');
    });
  });
});
