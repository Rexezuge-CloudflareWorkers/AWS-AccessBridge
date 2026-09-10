import { DataCollectionConfigDAO } from '@/dao';
import { BadRequestError } from '@/error';
import { IAdminActivityAPIRoute } from '@/endpoints/IAdminActivityAPIRoute';
import type { IAdminEnv, IRequest, IResponse } from '@/endpoints/IAdminActivityAPIRoute';

class DisableDataCollectionRoute extends IAdminActivityAPIRoute<DisableDataCollectionRequest, DisableDataCollectionResponse, IAdminEnv> {
  schema = {
    tags: ['Admin'],
    summary: 'Disable Data Collection',
    description:
      'Disables a specific type of data collection (cost or resource) for a credential. The background scheduled task will stop collecting that type of data for the associated AWS account on the next run.',
    requestBody: {
      description: 'Collection type to disable',
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            required: ['principalArn', 'collectionType'],
            properties: {
              principalArn: {
                type: 'string' as const,
                description: 'Principal ARN of the stored credential to disable collection for',
                example: 'arn:aws:iam::123456789012:role/MonitoringRole',
              },
              collectionType: {
                type: 'string' as const,
                enum: ['cost', 'resource'],
                description: 'Type of data collection to disable',
                example: 'cost',
              },
            },
          },
          examples: {
            'disable-cost': {
              summary: 'Disable cost collection',
              value: { principalArn: 'arn:aws:iam::123456789012:role/MonitoringRole', collectionType: 'cost' },
            },
            'disable-resource': {
              summary: 'Disable resource collection',
              value: { principalArn: 'arn:aws:iam::123456789012:role/MonitoringRole', collectionType: 'resource' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Data collection disabled successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, example: true },
                message: { type: 'string' as const, example: 'Data collection disabled.' },
              },
            },
            examples: {
              disabled: {
                summary: 'Collection disabled',
                value: { success: true, message: 'Data collection disabled.' },
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
                    Message: { type: 'string' as const, example: 'Missing required fields: principalArn and collectionType.' },
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
        description: 'Internal server error while disabling data collection',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: { type: 'string' as const, example: 'InternalServerError' },
                    Message: { type: 'string' as const, example: 'Failed to disable data collection.' },
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

  protected async handleAdminRequest(request: DisableDataCollectionRequest, env: IAdminEnv): Promise<DisableDataCollectionResponse> {
    if (!request.principalArn || !request.collectionType) {
      throw new BadRequestError('Missing required fields: principalArn and collectionType.');
    }
    const dao: DataCollectionConfigDAO = new DataCollectionConfigDAO(env.AccessBridgeDB);
    await dao.delete(request.principalArn, request.collectionType);
    return { success: true, message: 'Data collection disabled.' };
  }
}

interface DisableDataCollectionRequest extends IRequest {
  principalArn: string;
  collectionType: string;
}
interface DisableDataCollectionResponse extends IResponse {
  success: boolean;
  message: string;
}

export { DisableDataCollectionRoute };
