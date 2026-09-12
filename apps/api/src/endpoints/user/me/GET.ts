import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';

class GetCurrentUserRoute extends IActivityAPIRoute<GetCurrentUserRequest, GetCurrentUserResponse, GetCurrentUserEnv> {
  schema = {
    tags: ['User'],
    summary: 'Get Current User Information',
    description:
      'Returns information about the currently authenticated user, including their email address extracted from Cloudflare Access headers. This endpoint is useful for displaying user context in the frontend application.',
    responses: {
      '200': {
        description: 'Successfully retrieved current user information',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              required: ['email', 'isSuperAdmin', 'demoMode'],
              properties: {
                email: {
                  type: 'string' as const,
                  format: 'email',
                  description: 'Email address of the authenticated user as provided by Cloudflare Access',
                  example: 'user@example.com',
                },
                isSuperAdmin: {
                  type: 'boolean' as const,
                  description: 'Whether the user has super admin privileges',
                  example: false,
                },
                demoMode: {
                  type: 'boolean' as const,
                  description: 'Whether the application is running in demo mode',
                  example: false,
                },
                preferredLanguage: {
                  type: 'string' as const,
                  description: 'Preferred SPA locale tag (e.g., en, de); null when unset',
                  example: 'en',
                },
              },
            },
            examples: {
              'user-info': {
                summary: 'Current user information',
                value: {
                  email: 'john.doe@company.com',
                  isSuperAdmin: false,
                  demoMode: false,
                  preferredLanguage: 'en',
                },
              },
              'admin-user': {
                summary: 'Admin user information',
                value: {
                  email: 'admin@company.com',
                  isSuperAdmin: true,
                  demoMode: false,
                },
              },
            },
          },
        },
      },
      '401': {
        description: 'Unauthorized - Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'UnauthorizedError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Authentication error details',
                      example: 'No Cloudflare Access JWT token provided in request headers.',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '500': {
        description: 'Internal server error while retrieving user information',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                Exception: {
                  type: 'object' as const,
                  properties: {
                    Type: {
                      type: 'string' as const,
                      example: 'InternalServerError',
                    },
                    Message: {
                      type: 'string' as const,
                      description: 'Error description',
                      example: 'Failed to extract user information from headers',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [
      {
        CloudflareAccess: [],
      },
    ],
  };

  protected async handleRequest(
    request: GetCurrentUserRequest,
    env: GetCurrentUserEnv,
    cxt: ActivityContext<GetCurrentUserEnv>,
  ): Promise<GetCurrentUserResponse> {
    const demoMode: boolean = this.isDemoMode(cxt);
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(env.AccessBridgeDB);

    const [, isSuperAdmin, preferredLanguage]: [void, boolean, string | null] = await Promise.all([
      userMetadataDAO.ensureUserEmailExists(userEmail),
      userMetadataDAO.isSuperAdmin(userEmail),
      userMetadataDAO.getPreferredLanguage(userEmail),
    ]);

    return {
      email: userEmail,
      isSuperAdmin,
      demoMode,
      preferredLanguage,
    };
  }
}

type GetCurrentUserRequest = IRequest;

interface GetCurrentUserResponse extends IResponse {
  email: string;
  isSuperAdmin: boolean;
  demoMode: boolean;
  preferredLanguage: string | null;
}

type GetCurrentUserEnv = IEnv;

export { GetCurrentUserRoute };
export type { GetCurrentUserRequest, GetCurrentUserResponse };
