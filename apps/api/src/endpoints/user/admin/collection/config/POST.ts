
import type { ActivityContext } from '@/endpoints/IAdminActivityAPIRoute';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';
import { getRequestScope } from '@aws-access-bridge/backend-services/composition';
import { Tokens } from '@aws-access-bridge/backend-services/composition';

import { badRequestResponse, forbiddenResponse, internalServerErrorResponse, unauthorizedResponse } from '@aws-access-bridge/shared/schema/exceptionResponses';
class EnableDataCollectionRoute extends IAdminActivityAPIRoute<EnableDataCollectionRequest, EnableDataCollectionResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Enable Data Collection',
    description:
      'Enable cost and/or resource inventory data collection for a credential. Once enabled, the background scheduled tasks (CostDataCollectionTask and ResourceInventoryCollectionTask) will use this credential to collect data from AWS. The credential must have appropriate IAM permissions (ce:GetCostAndUsage for cost, ec2/s3/lambda/rds describe/list for resources).',
    requestBody: {
      description: 'Data collection configuration',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn', 'collectionTypes'],
            properties: {
              principalArn: {
                type: 'string' as const,
                description: 'Principal ARN of the stored credential to enable collection for',
                example: 'arn:aws:iam::123456789012:role/CostExplorerRole',
              },
              collectionTypes: {
                type: 'array' as const,
                description: 'Types of data collection to enable',
                items: { type: 'string' as const, enum: ['cost', 'resource'] },
              },
            },
          },
          examples: {
            'enable-both': {
              summary: 'Enable cost and resource collection',
              value: { principalArn: 'arn:aws:iam::123456789012:role/MonitoringRole', collectionTypes: ['cost', 'resource'] },
            },
            'cost-only': {
              summary: 'Enable cost collection only',
              value: { principalArn: 'arn:aws:iam::123456789012:role/CostExplorerRole', collectionTypes: ['cost'] },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Data collection enabled successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, description: 'Confirmation message listing enabled collection types' },
              },
            },
            examples: {
              enabled: {
                summary: 'Collection enabled',
                value: { success: true, message: 'Data collection enabled for cost, resource.' },
              },
            },
          },
        },
      },
      '400': badRequestResponse('Bad request - Missing required fields'),
      '401': unauthorizedResponse('Unauthorized - Missing or invalid authentication'),
      '403': forbiddenResponse('Forbidden - User is not a superadmin'),
      '500': internalServerErrorResponse('Internal server error while enabling data collection'),
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(request: EnableDataCollectionRequest, env: IAdminEnv,
    cxt: ActivityContext<IAdminEnv>): Promise<EnableDataCollectionResponse> {
    await getRequestScope(cxt).get(Tokens.CostService).enableCollection(request.principalArn, request.collectionTypes);
    return { success: true, message: `Data collection enabled for ${request.collectionTypes.join(', ')}.` };
  }
}

interface EnableDataCollectionRequest extends IRequest {
  principalArn: string;
  collectionTypes: string[];
}
interface EnableDataCollectionResponse extends IResponse {
  success: boolean;
  message: string;
}

export { EnableDataCollectionRoute };
