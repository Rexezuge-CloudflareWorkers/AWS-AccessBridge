/**
 * Shared OpenAPI schema fragments for admin routes.
 * Previously ~40 admin route files each inlined ~80 lines of identical
 * `responses.400/401/500` + `security: CloudflareAccess` Chanfana
 * scaffold (~250 lines schema vs ~18 lines handler). New routes compose
 * these; existing routes migrate incrementally.
 */

const ADMIN_SECURITY = [
  {
    CloudflareAccess: [],
  },
] as const;

function errorResponse(description: string, type: string, message: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object' as const,
          properties: {
            Exception: {
              type: 'object' as const,
              properties: {
                Type: { type: 'string' as const, example: type },
                Message: { type: 'string' as const, description, example: message },
              },
            },
          },
        },
      },
    },
  };
}

function adminErrorResponses(operation: string) {
  return {
    '400': errorResponse(`Invalid request - ${operation}`, 'BadRequestError', 'Missing required fields.'),
    '401': errorResponse(
      'Unauthorized - Missing authentication or invalid user',
      'UnauthorizedError',
      'No Cloudflare Access JWT token provided in request headers.',
    ),
    '500': errorResponse(`Internal server error during ${operation}`, 'InternalServerError', `Failed to ${operation}`),
  };
}

function adminRouteSchema(summary: string, description: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tags: ['Admin'],
    summary,
    description,
    ...extra,
    security: ADMIN_SECURITY,
  };
}

export { ADMIN_SECURITY, adminErrorResponses, adminRouteSchema, errorResponse };
