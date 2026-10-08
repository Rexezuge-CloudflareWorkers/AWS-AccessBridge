import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse, ExtendedResponse } from '@/endpoints/IActivityAPIRoute';
import { BadRequestError } from '@aws-access-bridge/backend-errors';

import type { RoleConfig } from '@aws-access-bridge/shared/model';
import { buildPrincipalArn } from '@aws-access-bridge/shared/utils/aws';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import {
  badRequestResponse,
  forbiddenResponse,
  internalServerErrorResponse,
  unauthorizedResponse,
} from '@aws-access-bridge/shared/schema/exceptionResponses';
class FederateRoute extends IActivityAPIRoute<FederateRequest, FederateResponse, FederateEnv> {
  schema = {
    tags: ['AWS'],
    summary: 'Federate AWS Access',
    description:
      'Assumes an AWS role and generates a console URL in a single request. This endpoint combines role assumption and console URL generation into one operation, returning a redirect to the AWS Console.',
    parameters: [
      {
        name: 'awsAccountId',
        in: 'query' as const,
        required: true,
        schema: {
          type: 'string' as const,
          pattern: String.raw`^\d{12}$`,
          description: 'AWS Account ID (12 digits)',
          example: '123456789012',
        },
      },
      {
        name: 'role',
        in: 'query' as const,
        required: true,
        schema: {
          type: 'string' as const,
          description: 'AWS IAM Role name',
          example: 'DeveloperRole',
        },
      },
      {
        name: 'destinationPath',
        in: 'query' as const,
        required: false,
        schema: {
          type: 'string' as const,
          description: 'Optional AWS Console path to redirect to after role assumption',
          example: 'ec2/home#InstanceDetails:instanceId=i-0abc123def456789',
        },
      },
      {
        name: 'destinationRegion',
        in: 'query' as const,
        required: false,
        schema: {
          type: 'string' as const,
          description: 'Optional AWS region to set in the destination URL',
          example: 'us-east-1',
        },
      },
    ],
    responses: {
      '302': {
        description: 'Redirect to AWS Console URL',
        headers: {
          Location: {
            description: 'Pre-authenticated AWS Console URL that expires after 15 minutes',
            schema: {
              type: 'string' as const,
              format: 'uri',
              example:
                'https://signin.aws.amazon.com/federation?Action=login&Issuer=AccessBridge&Destination=https%3A%2F%2Fconsole.aws.amazon.com%2F&SigninToken=VCaXjShAlpsXGHeOP1HnSjxuJMd1c1YvwjKNsKGKigo',
            },
          },
        },
      },
      '400': badRequestResponse('Missing required query parameters'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid Cloudflare Access authentication'),
      '403': forbiddenResponse('Forbidden - User not authorized to assume the specified role'),
      '500': internalServerErrorResponse('Internal server error during role assumption or URL generation'),
    },
    // Registered on both surfaces: /user/aws/* (Cloudflare Access JWT)
    // and /api/aws/* (Bearer PAT or HMAC-signed internal calls).
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleRequest(
    request: FederateRequest,
    _env: FederateEnv,
    cxt: ActivityContext<FederateEnv>,
  ): Promise<ExtendedResponse<FederateResponse>> {
    const url: URL = new URL(request.raw.url);
    const awsAccountId: string | null = url.searchParams.get('awsAccountId');
    const roleName: string | null = url.searchParams.get('role');
    if (!awsAccountId || !roleName) {
      throw new BadRequestError('Missing required query parameters.');
    }
    const destinationPath: string | null = url.searchParams.get('destinationPath');
    const destinationRegion: string | null = url.searchParams.get('destinationRegion');
    // `buildPrincipalArn`, not a template literal: the role name may carry an IAM
    // path, and this is the same helper the web client uses to build this URL.
    const principalArn: string = buildPrincipalArn(awsAccountId, roleName);
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const baseUrl: string = this.getBaseUrl(cxt);
    const roleConfig: RoleConfig | undefined = await getRequestScope(cxt).get(Tokens.AccountService).getRoleConfig(awsAccountId, roleName);
    // In-process, not HMAC loopback: one audit event per federation, and the
    // caller's own auth context is reused rather than a self-signed fetch cycle.
    const consoleUrl: string = await getRequestScope(cxt)
      .get(Tokens.FederationService)
      .generateConsoleUrlForUser(
        userEmail,
        principalArn,
        baseUrl,
        awsAccountId,
        roleName,
        destinationPath || roleConfig?.destinationPath,
        destinationRegion || roleConfig?.destinationRegion,
      );
    return {
      statusCode: 302,
      headers: {
        Location: consoleUrl,
      },
    };
  }
}

type FederateRequest = IRequest;

type FederateResponse = IResponse;

interface FederateEnv extends IEnv {
  SELF: Fetcher;
  INTERNAL_REQUEST_HMAC_SECRET: SecretsStoreSecret;
}

export { FederateRoute };
