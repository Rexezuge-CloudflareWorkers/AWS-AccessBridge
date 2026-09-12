interface AssumableAccount {
  roles: string[];
  hiddenRoles?: string[];
  nickname?: string;
  favorite?: boolean;
}

type AssumableAccountsMap = Record<string, AssumableAccount>;

interface AssumableAccountsResponse {
  [accountId: string]: AssumableAccount | number;
  totalAccounts: number;
}

export type { AssumableAccount, AssumableAccountsMap, AssumableAccountsResponse };
