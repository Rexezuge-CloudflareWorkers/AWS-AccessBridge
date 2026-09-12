interface AccessableAccount {
  userEmail: string;
  awsAccountId: string;
}

interface AccessableAccountInternal {
  user_email: string;
  aws_account_id: string;
}

export type { AccessableAccount, AccessableAccountInternal };
