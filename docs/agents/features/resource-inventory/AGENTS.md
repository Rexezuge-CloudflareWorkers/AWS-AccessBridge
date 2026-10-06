# Resource Inventory

Scope: EC2/S3/Lambda/RDS/DynamoDB discovery. Parent index: `../../../AGENTS.md`.

`ResourceInventoryCollectionTask` (phase 2, 2 accounts/invocation) resolves the collector registry **through the composition root** (`createRequestScope(env).get(Tokens.CollectorRegistry)` — a fresh scope per run, because a Durable Object's `env` is stable for its lifetime and a cached scope would pin the memoized encryption keys after a rotation), sweeps every collector across every configured region, upserts into `resource_inventory` (`ResourceInventoryDAO`), then deletes stale rows per type. Read surface: `GET /user/resources` (filters) + `GET /user/resources/summary` (via `ResourceService`). Frontend: `ResourceInventory` in `apps/web` (console deep-links per resource type).

## Regions

**Inventory covers every region, not `us-east-1`.** `BaseAwsCollector.collect` takes an optional region that defaulted to `us-east-1`, and its one production caller passed none — so an account's EC2/Lambda/RDS/DynamoDB inventory reported only that one slice while `GET /user/resources` filters by region and the UI presented it as complete.

`IAwsResourceCollector` therefore exposes `collectAllRegions(keys, regions)`, returning `{items, succeededRegions, failedRegions}`. It sweeps concurrently (a sequential sweep would multiply collection wall-clock by the region count inside a cron-driven Durable Object on a 10-minute tick) and **never throws for a regional failure**: a role denied in one region still has the other 26, and discarding those would make one `AccessDenied` erase a real inventory. `isRegional` is `false` for S3, which is global and swept exactly once against its own endpoint — otherwise a 27-region list would issue 27 identical `ListBuckets` calls per account.

Regions come from `INVENTORY_REGIONS` (comma-separated), falling back to `DEFAULT_INVENTORY_REGIONS` in `backend-runtime/src/constants/InventoryRegions.ts`. An explicit list rather than `ec2:DescribeRegions`, because discovery would be a **breaking IAM change** — every existing assumed-role policy grants only what the collectors read today, so requiring one more action breaks collection for every deployed role until an operator updates it. The list is normalised, because each raw form is a silent misconfiguration: whitespace requests a non-existent endpoint, an empty entry an unsigned request to the service root, a duplicate multiplies the API calls per account.

## Pruning keys on completeness, not on "did not throw"

A type is prunable **only when every configured region it was asked to read succeeded**. This is stricter than the previous rule, and the difference is load-bearing under a per-region sweep: keying on "the collector returned" would mean a role denied in `eu-west-1` prunes the account's entire multi-region inventory down to the 26 regions it could still read. An empty-but-successful region is a real answer ("this account has none") and counts as read; a failed one does not. The failure reason is carried through so the task logs *which* region was unreadable.

## Every list call follows its continuation token

There is a `paginate` Template step on `BaseAwsCollector`, and **a collector must never read one page and call it the whole list**. EC2 caps `DescribeInstances` at 1000 instances, Lambda and DynamoDB at 100 items, RDS at 100 — and because the task *prunes* on success, an account above those thresholds had its inventory permanently capped: the first run stored a page, each later run deleted everything beyond it and re-added the same page. Each service spells the protocol differently (EC2/RDS Query parameters, Lambda a `Marker` query parameter, DynamoDB an `ExclusiveStartTableName` body field, S3 the V2 `NextContinuationToken` — the V1 listing cannot be paginated at all), which is why `paginate` takes `fetchPage`/`readNextToken` from the caller rather than inferring them.

A repeated token stops the walk and logs, rather than re-fetching one page until the request's wall-clock limit. Tests: `test/collectors/CollectorPagination.test.ts`, `test/collectors/MultiRegionSweep.test.ts`.

## Cost Explorer follows its pages too, and merges per period

`GetCostAndUsage` pages and signals more with `NextPageToken`. Omitting that was a **spend** bug: `CostService`'s totals, and therefore every spend alert, are computed from these groups, so a truncated page reported spend *below* the account's actual figure and an alert set near the real threshold could be missed indefinitely — invisibly, because a partial page is a well-formed response. Pages are accumulated **per period** rather than emitted per page, because `CostDataDAO.upsertCostData` keys on `(account, period_start)` with `INSERT OR REPLACE` — emitting one result per page would have the second silently replace the first and store only the last page's cost.