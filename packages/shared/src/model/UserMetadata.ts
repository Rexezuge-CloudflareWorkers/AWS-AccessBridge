interface UserMetadataInternal {
  user_email?: string;
  is_superadmin?: boolean;
  federation_username?: string;
  preferred_language?: string | null;
}

export type { UserMetadataInternal };
