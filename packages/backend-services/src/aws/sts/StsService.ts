import type { AccessKeys, AccessKeysWithExpiration } from '@aws-access-bridge/shared/model';
import { StsClient, defaultAwsClientFactory } from '@aws-access-bridge/provider-clients/aws';
import type { AwsClientFactory,  } from '@aws-access-bridge/provider-clients/aws';
import type { CallerIdentity } from '@aws-access-bridge/provider-clients/aws';

/**
 * Domain STS service (Layer 3). Thin orchestration over the raw
 * `provider-clients` `StsClient` (Layer 2, Otter precedent).
 * Public API preserved; new code may import `StsClient` directly.
 */
class StsService {
  private readonly client: StsClient;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.client = new StsClient(clientFactory);
  }

  public async assumeRole(
    roleArn: string,
    accessKeys: AccessKeys,
    sessionName: string,
    durationSeconds?: number,
    region = 'us-east-1',
  ): Promise<AccessKeysWithExpiration> {
    return this.client.assumeRole(roleArn, accessKeys, sessionName, durationSeconds, region);
  }

  public async validateCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string): Promise<CallerIdentity> {
    return this.client.validateCredentials(accessKeyId, secretAccessKey, sessionToken);
  }
}

export { StsService,  };


export {type AwsClientOptions, defaultAwsClientFactory, type AwsClientFactory, type CallerIdentity} from '@aws-access-bridge/provider-clients/aws';