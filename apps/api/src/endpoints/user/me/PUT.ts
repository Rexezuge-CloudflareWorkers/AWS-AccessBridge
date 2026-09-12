import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { UserMetadataDAO } from '@aws-access-bridge/backend-data/dao';

class UpdateCurrentUserRoute extends IActivityAPIRoute<UpdateCurrentUserRequest, UpdateCurrentUserResponse, UpdateCurrentUserEnv> {
  schema = {
    tags: ['User'],
    summary: 'Update Current User Preferences',
    description: 'Updates preferences for the currently authenticated user, such as the preferred SPA locale.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object' as const,
            properties: {
              preferredLanguage: {
                type: 'string' as const,
                description: 'Preferred SPA locale tag (e.g., en, de, zh-CN); null clears the preference',
                example: 'de',
              },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Preferences updated',
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: {
                success: { type: 'boolean' as const, description: 'Whether the update succeeded' },
                preferredLanguage: {
                  type: 'string' as const,
                  description: 'Stored preferred locale tag (null when cleared)',
                  example: 'de',
                },
              },
            },
            examples: {
              updated: {
                summary: 'Preference stored',
                value: { success: true, preferredLanguage: 'de' },
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
    },
    security: [{ CloudflareAccess: [] }],
  };

  protected async handleRequest(
    request: UpdateCurrentUserRequest,
    env: UpdateCurrentUserEnv,
    cxt: ActivityContext<UpdateCurrentUserEnv>,
  ): Promise<UpdateCurrentUserResponse> {
    const userEmail: string = this.getAuthenticatedUserEmailAddress(cxt);
    const userMetadataDAO: UserMetadataDAO = new UserMetadataDAO(env.AccessBridgeDB);
    await userMetadataDAO.ensureUserEmailExists(userEmail);
    const preferredLanguage: string | null = request.preferredLanguage?.trim() || null;
    await userMetadataDAO.updatePreferredLanguage(userEmail, preferredLanguage);
    return { success: true, preferredLanguage };
  }
}

interface UpdateCurrentUserRequest extends IRequest {
  preferredLanguage?: string;
}

interface UpdateCurrentUserResponse extends IResponse {
  success: boolean;
  preferredLanguage: string | null;
}

type UpdateCurrentUserEnv = IEnv;

export { UpdateCurrentUserRoute };
export type { UpdateCurrentUserRequest, UpdateCurrentUserResponse };
