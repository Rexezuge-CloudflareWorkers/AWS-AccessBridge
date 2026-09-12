import type { AccessKeys } from '@aws-access-bridge/shared/model';
import { BadRequestError, InternalServerError } from '@aws-access-bridge/backend-errors';
import type { AwsClientFactory } from '../../http';
import { defaultAwsClientFactory } from '../sts';

interface DiscoveredRole {
  roleName: string;
  arn: string;
  description: string;
}

class IamService {
  private readonly clientFactory: AwsClientFactory;

  constructor(clientFactory: AwsClientFactory = defaultAwsClientFactory) {
    this.clientFactory = clientFactory;
  }

  public async listRoles(accessKeys: AccessKeys): Promise<DiscoveredRole[]> {
    const iamClient = this.clientFactory({ service: 'iam', region: 'us-east-1', keys: accessKeys });

    const queryParams: URLSearchParams = new URLSearchParams({
      Action: 'ListRoles',
      Version: '2010-05-08',
      MaxItems: '100',
    });

    const url: string = `https://iam.amazonaws.com/?${queryParams.toString()}`;
    const response: Response = await iamClient.fetch(url, { method: 'GET' });
    const xmlText: string = await response.text();

    if (!response.ok) {
      if (xmlText.includes('AccessDenied') || xmlText.includes('not authorized')) {
        throw new BadRequestError('The assumed role does not have iam:ListRoles permission. You can still manually enter role names.');
      }
      throw new InternalServerError(`IAM ListRoles failed: ${response.status}`);
    }

    const roles: DiscoveredRole[] = [];
    const memberRegex = /<member>([\s\S]*?)<\/member>/g;
    let memberMatch: RegExpExecArray | null;
    while ((memberMatch = memberRegex.exec(xmlText)) !== null) {
      const member: string = memberMatch[1];
      const roleNameMatch: RegExpMatchArray | null = /<RoleName>([^<]+)<\/RoleName>/.exec(member);
      const arnMatch: RegExpMatchArray | null = /<Arn>([^<]+)<\/Arn>/.exec(member);
      const descMatch: RegExpMatchArray | null = /<Description>([^<]*)<\/Description>/.exec(member);

      if (roleNameMatch && arnMatch) {
        roles.push({
          roleName: roleNameMatch[1],
          arn: arnMatch[1],
          description: descMatch ? descMatch[1] : '',
        });
      }
    }

    return roles;
  }
}

export { IamService };
export type { DiscoveredRole };
