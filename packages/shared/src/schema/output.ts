import { z } from 'zod';

const SuccessResponseSchema = z.object({
  success: z.boolean(),
});

const MessageResponseSchema = SuccessResponseSchema.extend({
  message: z.string(),
});

const ErrorResponseSchema = z.object({
  Exception: z.object({
    Type: z.string(),
    Message: z.string(),
  }),
});

const AccessKeysResponseSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string().optional(),
  expiration: z.string().optional(),
});

const ConsoleUrlResponseSchema = z.object({
  url: z.string().url(),
});

const TeamSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  createdAt: z.number(),
  createdBy: z.string(),
});

const TeamMemberSchema = z.object({
  teamId: z.string(),
  userEmail: z.string(),
  role: z.enum(['admin', 'member']),
  joinedAt: z.number(),
});

const SpendAlertSchema = z.object({
  alertId: z.string(),
  awsAccountId: z.string(),
  thresholdAmount: z.number(),
  currency: z.string(),
  periodType: z.string(),
  createdBy: z.string(),
  createdAt: z.number(),
  enabled: z.boolean(),
});

const CostDataSchema = z.object({
  awsAccountId: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalCost: z.number(),
  currency: z.string(),
  serviceBreakdown: z.record(z.string(), z.number()),
  collectedAt: z.number(),
});

const ResourceInventoryItemSchema = z.object({
  awsAccountId: z.string(),
  region: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  resourceName: z.string(),
  state: z.string(),
  metadata: z.record(z.string(), z.string()),
  collectedAt: z.number(),
});

const AuditLogSchema = z.object({
  logId: z.string(),
  timestamp: z.number(),
  userEmail: z.string(),
  action: z.string(),
  resource: z.string().optional(),
  method: z.string(),
  path: z.string(),
  statusCode: z.number(),
  detail: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

const UserAccessTokenMetadataSchema = z.object({
  tokenId: z.string(),
  userEmail: z.string(),
  name: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastUsedAt: z.number().optional(),
});

const TaskRunSchema = z.object({
  runId: z.string(),
  taskType: z.string(),
  status: z.string(),
  itemsProcessed: z.number(),
  itemsFailed: z.number(),
  summary: z.string().nullable(),
  details: z.unknown(),
  errorMessage: z.string().nullable(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  createdAt: z.number(),
});

const AssumableAccountSchema = z.object({
  roles: z.array(z.string()),
  hiddenRoles: z.array(z.string()).optional(),
  nickname: z.string().optional(),
  favorite: z.boolean().optional(),
});

const AssumableAccountsResponseSchema = z
  .object({
    totalAccounts: z.number(),
  })
  .catchall(z.union([AssumableAccountSchema, z.number()]));

const RoleDiscoveryItemSchema = z.object({
  roleName: z.string(),
  arn: z.string(),
  description: z.string(),
});

const CredentialValidationResponseSchema = z.object({
  valid: z.boolean(),
  arn: z.string(),
  accountId: z.string(),
  userId: z.string(),
});

const CredentialChainTestResponseSchema = z.object({
  success: z.boolean(),
  chain: z.array(
    z.object({
      arn: z.string(),
      status: z.string(),
    }),
  ),
});

const CostSummaryResponseSchema = z.object({
  accounts: z.record(
    z.string(),
    z.object({
      totalCost: z.number(),
      currency: z.string(),
    }),
  ),
  grandTotal: z.number(),
});

const CostTrendsResponseSchema = z.object({
  months: z.array(
    z.object({
      period: z.string(),
      total: z.number(),
      byAccount: z.record(z.string(), z.number()),
    }),
  ),
});

const ResourceSummaryResponseSchema = z.object({
  totalResources: z.number(),
  byType: z.record(z.string(), z.number()),
  byAccount: z.record(z.string(), z.record(z.string(), z.number())),
});

const CleanupOrphanedDataResponseSchema = z.object({
  deletedCounts: z.object({
    dataCollectionConfig: z.number(),
    roleConfigs: z.number(),
    teamAccounts: z.number(),
    spendAlerts: z.number(),
    costData: z.number(),
    resourceInventory: z.number(),
    awsAccounts: z.number(),
  }),
  totalDeleted: z.number(),
});

const RouteOutputSchemas = {
  'POST /api/aws/assume-role': AccessKeysResponseSchema,
  'POST /api/aws/console': ConsoleUrlResponseSchema,
  'GET /api/aws/federate': z.undefined(),
  'POST /user/aws/assume-role': AccessKeysResponseSchema,
  'POST /user/aws/console': ConsoleUrlResponseSchema,
  'GET /user/aws/federate': z.undefined(),
  'GET /user/assumables': AssumableAccountsResponseSchema,
  'GET /user/assumables/search': z.record(z.string(), AssumableAccountSchema),
  'GET /user/me': z.object({
    email: z.string(),
    isSuperAdmin: z.boolean(),
    demoMode: z.boolean(),
    preferredLanguage: z.string().nullable(),
  }),
  'PUT /user/me': z.object({
    success: z.boolean(),
    preferredLanguage: z.string().nullable(),
  }),
  'POST /user/favorites': SuccessResponseSchema,
  'DELETE /user/favorites': SuccessResponseSchema,
  'POST /user/assumable/hidden': SuccessResponseSchema,
  'DELETE /user/assumable/hidden': SuccessResponseSchema,
  'POST /user/tokens': z.object({
    tokenId: z.string(),
    token: z.string(),
    name: z.string(),
    expiresAt: z.number(),
  }),
  'DELETE /user/tokens': SuccessResponseSchema,
  'GET /user/tokens': z.object({
    tokens: z.array(UserAccessTokenMetadataSchema),
  }),
  'GET /user/admin/audit-logs': z.object({
    logs: z.array(AuditLogSchema),
    total: z.number(),
  }),
  'POST /user/admin/credentials': MessageResponseSchema,
  'POST /user/admin/credentials/relationship': MessageResponseSchema,
  'DELETE /user/admin/credentials/relationship': MessageResponseSchema,
  'POST /user/admin/access': MessageResponseSchema,
  'DELETE /user/admin/access': MessageResponseSchema,
  'PUT /user/admin/account/nickname': z.object({
    success: z.boolean(),
    accountId: z.string(),
    nickname: z.string(),
  }),
  'DELETE /user/admin/account/nickname': z.object({
    success: z.boolean(),
    accountId: z.string(),
  }),
  'PUT /user/admin/role/config': MessageResponseSchema,
  'DELETE /user/admin/role/config': MessageResponseSchema,
  'POST /user/admin/credentials/validate': CredentialValidationResponseSchema,
  'POST /user/admin/credentials/test-chain': CredentialChainTestResponseSchema,
  'POST /user/admin/account/roles': z.object({
    roles: z.array(RoleDiscoveryItemSchema),
  }),
  'GET /user/costs/summary': CostSummaryResponseSchema,
  'GET /user/costs/account': z.object({
    awsAccountId: z.string(),
    dailyCosts: z.array(CostDataSchema),
    serviceBreakdown: z.record(z.string(), z.number()),
    total: z.number(),
  }),
  'GET /user/costs/trends': CostTrendsResponseSchema,
  'POST /user/admin/costs/alerts': z.object({
    success: z.boolean(),
    alert: SpendAlertSchema,
  }),
  'DELETE /user/admin/costs/alerts': MessageResponseSchema,
  'POST /user/admin/collection/config': MessageResponseSchema,
  'DELETE /user/admin/collection/config': MessageResponseSchema,
  'GET /user/resources': z.object({
    items: z.array(ResourceInventoryItemSchema),
    total: z.number(),
  }),
  'GET /user/resources/summary': ResourceSummaryResponseSchema,
  'GET /user/admin/teams': z.object({
    teams: z.array(TeamSchema),
  }),
  'GET /user/admin/team/members': z.object({
    members: z.array(TeamMemberSchema),
  }),
  'GET /user/admin/team/accounts': z.object({
    accountIds: z.array(z.string()),
  }),
  'POST /user/admin/team': z.object({
    success: z.boolean(),
    team: TeamSchema,
  }),
  'DELETE /user/admin/team': MessageResponseSchema,
  'PUT /user/admin/team/name': MessageResponseSchema,
  'POST /user/admin/team/member': MessageResponseSchema,
  'DELETE /user/admin/team/member': MessageResponseSchema,
  'PUT /user/admin/team/member/role': MessageResponseSchema,
  'POST /user/admin/team/account': MessageResponseSchema,
  'DELETE /user/admin/team/account': MessageResponseSchema,
  'POST /user/admin/maintenance/cleanup-orphaned': CleanupOrphanedDataResponseSchema,
  'GET /user/admin/maintenance/task-runs': z.object({
    runs: z.array(TaskRunSchema),
  }),
} as const;

export {
  AccessKeysResponseSchema,
  AssumableAccountSchema,
  AssumableAccountsResponseSchema,
  AuditLogSchema,
  CleanupOrphanedDataResponseSchema,
  ConsoleUrlResponseSchema,
  CostDataSchema,
  CostSummaryResponseSchema,
  CostTrendsResponseSchema,
  CredentialChainTestResponseSchema,
  CredentialValidationResponseSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  ResourceInventoryItemSchema,
  ResourceSummaryResponseSchema,
  RoleDiscoveryItemSchema,
  RouteOutputSchemas,
  SpendAlertSchema,
  SuccessResponseSchema,
  TaskRunSchema,
  TeamMemberSchema,
  TeamSchema,
  UserAccessTokenMetadataSchema,
};
