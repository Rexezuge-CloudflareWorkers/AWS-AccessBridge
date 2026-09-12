interface AssumableRole {
  userEmail: string;
  awsAccountId: string;
  roleName: string;
}

interface AssumableRoleInternal {
  user_email: string;
  aws_account_id: string;
  role_name: string;
}

export type { AssumableRole, AssumableRoleInternal };
