interface TeamMember {
  teamId: string;
  userEmail: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

interface TeamMemberInternal {
  team_id: string;
  user_email: string;
  role: string;
  joined_at: number;
}

export type { TeamMember, TeamMemberInternal };
