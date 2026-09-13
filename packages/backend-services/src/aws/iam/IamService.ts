import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { IamClient, defaultAwsClientFactory } from '@aws-access-bridge/provider-clients/aws';
import type { AwsClientFactory, DiscoveredRole } from '@aws-access-bridge/provider-clients/aws';

/**
 * Domain IAM service (Layer 3). Delegates raw discovery to
 * `provider-clients` `IamClient` (Layer 2).
 */
class IamService {
  private readonly client: IamClient;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.client = new IamClient(clientFactory);
  }

  public async listRoles(accessKeys: AccessKeys): Promise<DiscoveredRole[]> {
    return this.client.listRoles(accessKeys);
  }
}

export { IamService };


export {type DiscoveredRole} from '@aws-access-bridge/provider-clients/aws';