type BackgroundTaskRunStatus = 'running' | 'success' | 'partial_success' | 'error' | 'skipped';

interface BackgroundTaskRun {
  runId: string;
  taskType: string;
  status: BackgroundTaskRunStatus;
  itemsProcessed: number;
  itemsFailed: number;
  summary: string | null;
  details: unknown;
  errorMessage: string | null;
  startedAt: number;
  completedAt: number | null;
  createdAt: number;
}

interface BackgroundTaskRunInternal {
  run_id: string;
  task_type: string;
  status: BackgroundTaskRunStatus;
  items_processed: number;
  items_failed: number;
  summary: string | null;
  details: string | null;
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
  created_at: number;
}

export type { BackgroundTaskRun, BackgroundTaskRunInternal, BackgroundTaskRunStatus };
