interface UserMetadata {
  userEmail: string;
  isSuperAdmin: boolean;
  federationUsername: string;
  preferredLanguage: string | null;
}

interface UserMetadataInternal {
  user_email?: string;
  is_superadmin?: boolean;
  federation_username?: string;
  preferred_language?: string | null;
}

export type { UserMetadata, UserMetadataInternal };
