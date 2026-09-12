import { generateHMACSignature, hashBody } from '@aws-access-bridge/backend-data/crypto/hmac';
import {
  SELF_WORKER_BASE_URL,
  INTERNAL_BASE_URL_HEADER,
  INTERNAL_USER_EMAIL_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  CONTENT_TYPE,
  APPLICATION_JSON,
} from '@aws-access-bridge/shared/constants';

class InternalRequestHelper {
  protected readonly fetcher: Fetcher;
  protected readonly hmacSecret: string;

  constructor(fetcher: Fetcher, hmacSecret: string) {
    this.fetcher = fetcher;
    this.hmacSecret = hmacSecret;
  }

  public async makeRequest(
    path: string,
    method: string,
    body: string | null,
    baseUrl: string,
    userEmail: string,
    additionalHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const timestamp: string = Date.now().toString();
    const bodyHash: string = await hashBody(body || '');
    const headers: Record<string, string> = {
      [INTERNAL_BASE_URL_HEADER]: baseUrl,
      [INTERNAL_USER_EMAIL_HEADER]: userEmail,
      [INTERNAL_TIMESTAMP_HEADER]: timestamp,
      ...additionalHeaders,
    };
    headers[INTERNAL_SIGNATURE_HEADER] = await generateHMACSignature(this.hmacSecret, headers, timestamp, bodyHash, path, method);
    if (body) {
      headers[CONTENT_TYPE] = APPLICATION_JSON;
    }
    return this.fetcher.fetch(`${SELF_WORKER_BASE_URL}${path}`, {
      method,
      headers,
      body,
    });
  }
}

export { InternalRequestHelper };
