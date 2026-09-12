interface RoleConfig {
  awsAccountId: string;
  roleName: string;
  destinationPath?: string;
  destinationRegion?: string;
  roleSessionDurationSeconds?: number;
}

interface RoleConfigInternal {
  aws_account_id: string;
  role_name: string;
  destination_path?: string;
  destination_region?: string;
  role_session_duration_seconds?: number;
}

export type { RoleConfig, RoleConfigInternal };
