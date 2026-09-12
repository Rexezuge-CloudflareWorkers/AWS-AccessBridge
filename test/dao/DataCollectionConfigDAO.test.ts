import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataCollectionConfigDAO } from '@aws-access-bridge/backend-data/dao/DataCollectionConfigDAO';

describe('DataCollectionConfigDAO', () => {
  let mockDb: D1Database;
  let mockStmt: D1PreparedStatement;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
      first: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      raw: vi.fn(),
    } as unknown as D1PreparedStatement;

    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database;
  });

  describe('deleteOrphaned', () => {
    it('deletes rows whose principal_arn is absent from credentials and returns change count', async () => {
      vi.mocked(mockStmt.run).mockResolvedValue({ success: true, meta: { changes: 4 } } as unknown as D1Result);
      const dao = new DataCollectionConfigDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(4);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM data_collection_config.*NOT IN.*credentials/s));
    });

    it('returns 0 when meta is missing', async () => {
      const dao = new DataCollectionConfigDAO(mockDb);
      const count = await dao.deleteOrphaned();
      expect(count).toBe(0);
    });
  });
});
