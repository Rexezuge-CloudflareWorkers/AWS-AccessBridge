const DEFAULT_PRUNE_BATCH_SIZE = 500;

function computeUnixCutoffSeconds(retentionDays: number, nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) - retentionDays * 86_400;
}

function computeDateCutoffIso(retentionDays: number, nowMs: number = Date.now()): string {
  const date = new Date(nowMs - retentionDays * 86_400 * 1000);
  return date.toISOString().split('T', 1)[0] ?? date.toISOString().slice(0, 10);
}

async function pruneInBatches(
  deleteBatch: (batchSize: number) => Promise<number>,
  batchSize: number = DEFAULT_PRUNE_BATCH_SIZE,
): Promise<number> {
  let total = 0;
  let deleted = batchSize;
  while (deleted >= batchSize) {
    deleted = await deleteBatch(batchSize);
    total += deleted;
  }
  return total;
}

export { DEFAULT_PRUNE_BATCH_SIZE, computeDateCutoffIso, computeUnixCutoffSeconds, pruneInBatches };
