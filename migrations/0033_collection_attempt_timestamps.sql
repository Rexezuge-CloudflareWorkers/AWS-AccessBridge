-- Migration 0033: Separate the collection-attempt clock from the
-- collection-success clock.
--
-- `data_collection_config.last_collected_at` used to drive BOTH the "which
-- principals are due" query and the "when did we last succeed" answer. The
-- due-query therefore had no way to distinguish a principal that failed
-- (or returned empty) repeatedly from one that was collected recently:
-- every failed or empty attempt left `last_collected_at` untouched, so the
-- principal stayed due and was retried on the *next tick* while the
-- accounts behind it in the batch waited. With a bounded per-tick batch
-- that is starvation: enough failing rows occupy the whole batch and the
-- healthy principals are never collected.
--
-- After this migration the DAO stamps `last_attempt_at` on every attempt
-- (success, empty result, failure) and the due-query filters and orders by
-- it. `last_collected_at` stays success-only, so the collected-at answer
-- remains honest. The backfill copies the success clock forward so rows
-- that collected recently are not instantly due again.
--
-- The backfill guard (`last_attempt_at = 0`) makes the statement
-- idempotent: re-running it after the DAO has started writing the new
-- column leaves fresh attempt stamps alone.

ALTER TABLE data_collection_config ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0;

UPDATE data_collection_config SET last_attempt_at = last_collected_at WHERE last_attempt_at = 0;
