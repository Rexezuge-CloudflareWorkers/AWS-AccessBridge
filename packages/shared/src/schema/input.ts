import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import {
  AwsAccessKeyIdSchema,
  AwsAccountIdSchema,
  AwsDestinationPathSchema,
  AwsIamPrincipalArnSchema,
  AwsRegionSchema,
  AwsRoleSessionDurationSecondsSchema,
  AwsRoleNameSchema,
  AwsSecretAccessKeySchema,
  AwsSessionTokenSchema,
  BooleanQuerySchema,
  CollectionTypeSchema,
  EmailSchema,
  PeriodTypeSchema,
  TeamRoleSchema,
  UuidSchema,
  isoDateQuerySchema,
  nonEmptyStringSchema,
  nonNegativeIntegerQuerySchema,
  positiveIntegerQuerySchema,
} from './common';

interface RequestInputSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
}

type RequestSchemaMap = Record<string, RequestInputSchema>;

const PrincipalArnBodySchema = z.object({
  principalArn: AwsIamPrincipalArnSchema,
});

const AccountRoleBodySchema = z.object({
  awsAccountId: AwsAccountIdSchema,
  roleName: AwsRoleNameSchema,
});

const OptionalUserAccountRoleBodySchema = AccountRoleBodySchema.extend({
  userEmail: EmailSchema.optional(),
});

const AwsCredentialsBodySchema = z.object({
  accessKeyId: AwsAccessKeyIdSchema,
  secretAccessKey: AwsSecretAccessKeySchema,
  sessionToken: AwsSessionTokenSchema,
});

const StoreCredentialBodySchema = AwsCredentialsBodySchema.extend({
  principalArn: AwsIamPrincipalArnSchema,
});

const CredentialRelationshipBodySchema = z.object({
  principalArn: AwsIamPrincipalArnSchema,
  assumedBy: AwsIamPrincipalArnSchema,
});

const GenerateConsoleUrlBodySchema = AwsCredentialsBodySchema.extend({
  awsAccountId: AwsAccountIdSchema.optional(),
  roleName: AwsRoleNameSchema.optional(),
  destinationPath: AwsDestinationPathSchema,
  destinationRegion: AwsRegionSchema,
}).refine(
  (input: { awsAccountId?: string; roleName?: string }): boolean =>
    (!input.awsAccountId && !input.roleName) || Boolean(input.awsAccountId && input.roleName),
  {
    message: 'awsAccountId and roleName must be provided together.',
    path: ['roleName'],
  },
);

const FavoriteAccountBodySchema = z.object({
  awsAccountId: AwsAccountIdSchema,
});

const HiddenRoleBodySchema = AccountRoleBodySchema;

const UpdateCurrentUserBodySchema = z.object({
  preferredLanguage: nonEmptyStringSchema('preferredLanguage', 12).nullish(),
});

const CreateTokenBodySchema = z.object({
  name: nonEmptyStringSchema('name', 128),
  expiresInDays: z.number().int().min(1, 'expiresInDays must be at least 1.').optional(),
});

const DeleteTokenBodySchema = z.object({
  tokenId: UuidSchema,
});

const SetAccountNicknameBodySchema = z.object({
  awsAccountId: AwsAccountIdSchema,
  nickname: nonEmptyStringSchema('nickname', 255),
});

const RoleConfigBodySchema = AccountRoleBodySchema.extend({
  destinationPath: AwsDestinationPathSchema,
  destinationRegion: AwsRegionSchema,
  roleSessionDurationSeconds: AwsRoleSessionDurationSecondsSchema,
});

const CreateSpendAlertBodySchema = z.object({
  awsAccountId: AwsAccountIdSchema,
  thresholdAmount: z.number().positive('thresholdAmount must be greater than zero.'),
  periodType: PeriodTypeSchema.optional(),
});

const DeleteSpendAlertBodySchema = z.object({
  alertId: UuidSchema,
});

const EnableDataCollectionBodySchema = z.object({
  principalArn: AwsIamPrincipalArnSchema,
  collectionTypes: z.array(CollectionTypeSchema).min(1, 'collectionTypes must contain at least one value.'),
});

const DisableDataCollectionBodySchema = z.object({
  principalArn: AwsIamPrincipalArnSchema,
  collectionType: CollectionTypeSchema,
});

const CreateTeamBodySchema = z.object({
  teamName: nonEmptyStringSchema('teamName', 128),
});

const TeamIdBodySchema = z.object({
  teamId: UuidSchema,
});

const UpdateTeamNameBodySchema = TeamIdBodySchema.extend({
  teamName: nonEmptyStringSchema('teamName', 128),
});

const TeamMemberBodySchema = TeamIdBodySchema.extend({
  userEmail: EmailSchema,
});

const AddTeamMemberBodySchema = TeamMemberBodySchema.extend({
  role: TeamRoleSchema.optional(),
});

const UpdateTeamMemberRoleBodySchema = TeamMemberBodySchema.extend({
  role: TeamRoleSchema,
});

const TeamAccountBodySchema = TeamIdBodySchema.extend({
  awsAccountId: AwsAccountIdSchema,
});

const FederateQuerySchema = z.object({
  awsAccountId: AwsAccountIdSchema,
  role: AwsRoleNameSchema,
});

const ListAssumablesQuerySchema = z.object({
  showHidden: BooleanQuerySchema.optional(),
  limit: positiveIntegerQuerySchema('limit', 200).optional(),
  offset: nonNegativeIntegerQuerySchema('offset').optional(),
});

const SearchAssumablesQuerySchema = z.object({
  q: nonEmptyStringSchema('q', 256),
  showHidden: BooleanQuerySchema.optional(),
});

const AccountCostQuerySchema = z
  .object({
    awsAccountId: AwsAccountIdSchema,
    startDate: isoDateQuerySchema('startDate').optional(),
    endDate: isoDateQuerySchema('endDate').optional(),
  })
  .refine(
    (input: { startDate?: string; endDate?: string }): boolean => !input.startDate || !input.endDate || input.startDate <= input.endDate,
    {
      message: 'startDate must be on or before endDate.',
      path: ['startDate'],
    },
  );

const CostTrendsQuerySchema = z.object({
  months: positiveIntegerQuerySchema('months', 12).optional(),
});

const ListResourcesQuerySchema = z.object({
  accountId: AwsAccountIdSchema.optional(),
  type: z.enum(['ec2', 's3', 'lambda', 'rds']).optional(),
  search: nonEmptyStringSchema('search', 256).optional(),
  limit: positiveIntegerQuerySchema('limit', 200).optional(),
  offset: nonNegativeIntegerQuerySchema('offset').optional(),
});

const AuditLogsQuerySchema = z
  .object({
    userEmail: EmailSchema.optional(),
    action: nonEmptyStringSchema('action', 128).optional(),
    startTime: nonNegativeIntegerQuerySchema('startTime').optional(),
    endTime: nonNegativeIntegerQuerySchema('endTime').optional(),
    limit: positiveIntegerQuerySchema('limit', 200).optional(),
    offset: nonNegativeIntegerQuerySchema('offset').optional(),
  })
  .refine(
    (input: { startTime?: number; endTime?: number }): boolean =>
      input.startTime === undefined || input.endTime === undefined || input.startTime <= input.endTime,
    {
      message: 'startTime must be less than or equal to endTime.',
      path: ['startTime'],
    },
  );

const TeamIdQuerySchema = z.object({
  teamId: UuidSchema,
});

const TaskRunsQuerySchema = z.object({
  taskType: nonEmptyStringSchema('taskType', 128).optional(),
  status: nonEmptyStringSchema('status', 32).optional(),
  limit: positiveIntegerQuerySchema('limit', 200).optional(),
});

const RequestInputSchemas = {
  'POST /api/aws/console': { body: GenerateConsoleUrlBodySchema },
  'POST /api/aws/assume-role': { body: PrincipalArnBodySchema },
  'GET /api/aws/federate': { query: FederateQuerySchema },

  'POST /user/aws/console': { body: GenerateConsoleUrlBodySchema },
  'POST /user/aws/assume-role': { body: PrincipalArnBodySchema },
  'GET /user/aws/federate': { query: FederateQuerySchema },

  'GET /user/assumables': { query: ListAssumablesQuerySchema },
  'GET /user/assumables/search': { query: SearchAssumablesQuerySchema },
  'POST /user/favorites': { body: FavoriteAccountBodySchema },
  'DELETE /user/favorites': { body: FavoriteAccountBodySchema },
  'PUT /user/me': { body: UpdateCurrentUserBodySchema },
  'POST /user/assumable/hidden': { body: HiddenRoleBodySchema },
  'DELETE /user/assumable/hidden': { body: HiddenRoleBodySchema },
  'POST /user/tokens': { body: CreateTokenBodySchema },
  'DELETE /user/tokens': { body: DeleteTokenBodySchema },

  'POST /user/admin/credentials': { body: StoreCredentialBodySchema },
  'POST /user/admin/credentials/relationship': { body: CredentialRelationshipBodySchema },
  'DELETE /user/admin/credentials/relationship': { body: PrincipalArnBodySchema },
  'POST /user/admin/access': { body: OptionalUserAccountRoleBodySchema },
  'DELETE /user/admin/access': { body: OptionalUserAccountRoleBodySchema },
  'PUT /user/admin/account/nickname': { body: SetAccountNicknameBodySchema },
  'DELETE /user/admin/account/nickname': { body: FavoriteAccountBodySchema },
  'PUT /user/admin/role/config': { body: RoleConfigBodySchema },
  'DELETE /user/admin/role/config': { body: AccountRoleBodySchema },
  'POST /user/admin/credentials/validate': { body: AwsCredentialsBodySchema },
  'POST /user/admin/credentials/test-chain': { body: PrincipalArnBodySchema },
  'POST /user/admin/account/roles': { body: PrincipalArnBodySchema },
  'GET /user/admin/audit-logs': { query: AuditLogsQuerySchema },
  'GET /user/admin/maintenance/task-runs': { query: TaskRunsQuerySchema },

  'GET /user/costs/account': { query: AccountCostQuerySchema },
  'GET /user/costs/trends': { query: CostTrendsQuerySchema },
  'POST /user/admin/costs/alerts': { body: CreateSpendAlertBodySchema },
  'DELETE /user/admin/costs/alerts': { body: DeleteSpendAlertBodySchema },
  'POST /user/admin/collection/config': { body: EnableDataCollectionBodySchema },
  'DELETE /user/admin/collection/config': { body: DisableDataCollectionBodySchema },

  'GET /user/resources': { query: ListResourcesQuerySchema },

  'POST /user/admin/team': { body: CreateTeamBodySchema },
  'DELETE /user/admin/team': { body: TeamIdBodySchema },
  'PUT /user/admin/team/name': { body: UpdateTeamNameBodySchema },
  'POST /user/admin/team/member': { body: AddTeamMemberBodySchema },
  'DELETE /user/admin/team/member': { body: TeamMemberBodySchema },
  'GET /user/admin/team/members': { query: TeamIdQuerySchema },
  'PUT /user/admin/team/member/role': { body: UpdateTeamMemberRoleBodySchema },
  'POST /user/admin/team/account': { body: TeamAccountBodySchema },
  'DELETE /user/admin/team/account': { body: TeamAccountBodySchema },
  'GET /user/admin/team/accounts': { query: TeamIdQuerySchema },
} as const satisfies RequestSchemaMap;

export {
  AccountCostQuerySchema,
  AccountRoleBodySchema,
  AddTeamMemberBodySchema,
  AuditLogsQuerySchema,
  AwsCredentialsBodySchema,
  CreateSpendAlertBodySchema,
  CreateTeamBodySchema,
  CreateTokenBodySchema,
  CredentialRelationshipBodySchema,
  DeleteSpendAlertBodySchema,
  DeleteTokenBodySchema,
  DisableDataCollectionBodySchema,
  EnableDataCollectionBodySchema,
  FavoriteAccountBodySchema,
  FederateQuerySchema,
  GenerateConsoleUrlBodySchema,
  HiddenRoleBodySchema,
  ListAssumablesQuerySchema,
  ListResourcesQuerySchema,
  OptionalUserAccountRoleBodySchema,
  PrincipalArnBodySchema,
  RequestInputSchemas,
  RoleConfigBodySchema,
  SearchAssumablesQuerySchema,
  SetAccountNicknameBodySchema,
  TeamAccountBodySchema,
  TeamIdBodySchema,
  TeamIdQuerySchema,
  TaskRunsQuerySchema,
  TeamMemberBodySchema,
  UpdateCurrentUserBodySchema,
  UpdateTeamMemberRoleBodySchema,
  UpdateTeamNameBodySchema,
};
export type { RequestInputSchema, RequestSchemaMap };
