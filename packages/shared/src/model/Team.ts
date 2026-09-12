interface Team {
  teamId: string;
  teamName: string;
  createdAt: number;
  createdBy: string;
}

interface TeamInternal {
  team_id: string;
  team_name: string;
  created_at: number;
  created_by: string;
}

export type { Team, TeamInternal };
