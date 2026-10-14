import { describe, expect, it } from 'vitest';
import {
  CF_CONNECTING_IP_HEADER,
  CF_RAY_HEADER,
  API_WORKER_BASE_HOSTNAME,
  FORWARDED_FOR_HEADER,
  FORWARDED_HOST_HEADER,
  FORWARDED_PROTO_HEADER,
} from '@aws-access-bridge/shared/constants';
import { RequestOriginUtil } from '@aws-access-bridge/shared/utils/RequestOriginUtil';

function withCloudflareMetadata(request: Request): Request {
  Object.defineProperty(request, 'cf', {
    value: { colo: 'SFO' },
    configurable: true,
  });
  return request;
}

describe('RequestOriginUtil', () => {
  describe('isPagesProxyRequest', () => {
    it('returns true for api.invalid requests with Cloudflare metadata and required headers', () => {
      const request = withCloudflareMetadata(
        new Request(`https://${API_WORKER_BASE_HOSTNAME}/api/test`, {
          headers: {
            [CF_CONNECTING_IP_HEADER]: '203.0.113.10',
            [CF_RAY_HEADER]: 'test-ray',
          },
        }),
      );

      expect(RequestOriginUtil.isPagesProxyRequest(request)).toBe(true);
    });

    it('returns false when a direct request spoofs forwarded context headers', () => {
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

      expect(RequestOriginUtil.isPagesProxyRequest(request)).toBe(false);
    });

    it('returns false when api.invalid lacks Cloudflare request metadata', () => {
      const request = new Request(`https://${API_WORKER_BASE_HOSTNAME}/api/test`, {
        headers: {
          [CF_CONNECTING_IP_HEADER]: '203.0.113.10',
          [CF_RAY_HEADER]: 'test-ray',
        },
      });

      expect(RequestOriginUtil.isPagesProxyRequest(request)).toBe(false);
    });
  });

  describe('getClientIpAddress', () => {
    it('uses the first forwarded-for address for trusted Pages proxy requests', () => {
      const request = withCloudflareMetadata(
        new Request(`https://${API_WORKER_BASE_HOSTNAME}/api/test`, {
          headers: {
            [CF_CONNECTING_IP_HEADER]: '192.0.2.10',
            [CF_RAY_HEADER]: 'test-ray',
            [FORWARDED_FOR_HEADER]: '203.0.113.10, 198.51.100.8',
          },
        }),
      );

      expect(RequestOriginUtil.getClientIpAddress(request)).toBe('203.0.113.10');
    });

    it('ignores forwarded-for on direct requests', () => {
      const request = withCloudflareMetadata(
        new Request('https://worker.example.com/api/test', {
          headers: {
            [CF_CONNECTING_IP_HEADER]: '192.0.2.10',
            [CF_RAY_HEADER]: 'test-ray',
            [FORWARDED_FOR_HEADER]: '203.0.113.10',
          },
        }),
      );

      expect(RequestOriginUtil.getClientIpAddress(request)).toBe('192.0.2.10');
    });
  });
});
