import { IActivityAPIRoute } from '@/endpoints/IActivityAPIRoute';
import type { ActivityContext, IEnv, IRequest, IResponse } from '@/endpoints/IActivityAPIRoute';
import { BadRequestError } from '@aws-access-bridge/backend-errors';
import { UserServiceFactory } from '@aws-access-bridge/backend-services/user';
import { LocaleUtil } from '@aws-access-bridge/shared/utils';

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
    const raw = request.preferredLanguage ?? null;
    // Null/empty clears the preference; non-empty tags must be supported.
    if (raw !== null && typeof raw === 'string' && raw.trim() !== '') {
      const candidate = raw.trim().toLowerCase();
      const englishAliases = ['en', 'en-us', 'en_us', 'en-gb', 'en_gb'];
      if (!LocaleUtil.isSupported(raw) && LocaleUtil.normalize(raw) === 'en' && !englishAliases.includes(candidate)) {
        throw new BadRequestError('Unsupported language.');
      }
    } else if (raw !== null && typeof raw !== 'string') {
      throw new BadRequestError('Unsupported language.');
    }
    const preferredLanguage: string | null = await UserServiceFactory.create(env).updatePreferredLanguage(userEmail, raw);
    return { success: true, preferredLanguage };
  }
}

interface UpdateCurrentUserRequest extends IRequest {
  preferredLanguage?: string | null;
}

interface UpdateCurrentUserResponse extends IResponse {
  success: boolean;
  preferredLanguage: string | null;
}

type UpdateCurrentUserEnv = IEnv;

export { UpdateCurrentUserRoute };
export type { UpdateCurrentUserRequest, UpdateCurrentUserResponse };
