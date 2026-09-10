import { DataCollectionConfigDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

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
      '400': {
        description: 'Bad request - Missing required fields',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'BadRequestError' },
                    Message: { type: 'string' as const, example: 'Missing required fields: principalArn and collectionTypes.' },
                  },
                },
              },
            },
          },
        },
      },
      '401': {
        description: 'Unauthorized - Missing or invalid authentication',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'UnauthorizedError' },
                    Message: { type: 'string' as const, example: 'No Cloudflare Access JWT token provided in request headers.' },
                  },
                },
              },
            },
          },
        },
      },
      '403': {
        description: 'Forbidden - User is not a superadmin',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'UnauthorizedError' },
                    Message: { type: 'string' as const, example: 'User is not a super admin.' },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error while enabling data collection',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to enable data collection.' },
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleAdminRequest(request: EnableDataCollectionRequest, env: IAdminEnv): Promise<EnableDataCollectionResponse> {
    if (!request.principalArn || !request.collectionTypes?.length) {
      throw new BadRequestError('Missing required fields: principalArn and collectionTypes.');
    }
    const dao: DataCollectionConfigDAO = new DataCollectionConfigDAO(env.AccessBridgeDB);
    for (const type of request.collectionTypes) {
      await dao.create(request.principalArn, type);
    }
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
