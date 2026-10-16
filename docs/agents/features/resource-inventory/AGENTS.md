# Resource Inventory

Scope: EC2 / S3 / Lambda / RDS / DynamoDB discovery. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md).

## Collection

`ResourceInventoryCollectionTask` (cron phase 2) extends `AbstractCollectionTask`, two accounts per invocation. It resolves the collector registry **through the composition root** — `createRequestScope(env).get(Tokens.CollectorRegistry)`, a _fresh_ scope per run, because a Durable Object's `env` is stable for its lifetime and a cached scope would pin the memoized encryption keys after a rotation. Every collector sweeps every configured region, results upsert into `resource_inventory` (`ResourceInventoryDAO`), then stale rows are deleted per resource type.

Read surface: `GET /user/resources` (filters) and `GET /user/resources/summary`, through `ResourceService`, scoped to the caller's own accounts. Frontend: `ResourceInventory` in `apps/web`, with per-type Console deep-links.

## Inventory covers every region, not `us-east-1`

`BaseAwsCollector.collect` takes an optional region that defaulted to `us-east-1`, and its one production caller passed none — so EC2/Lambda/RDS/DynamoDB inventory reported only that one slice while the UI presented it as complete.

`IAwsResourceCollector` therefore exposes `collectAllRegions(keys, regions)`, returning `{items, succeededRegions, failedRegions}`. It sweeps concurrently (a sequential sweep would multiply wall-clock by the region count inside a 10-minute tick) and **never throws for a regional failure**: a role denied in one region still has the other 26, and one `AccessDenied` must not erase a real inventory. `isRegional` is `false` for S3, which is global and swept exactly once against its own endpoint — otherwise a 29-region list would issue 29 identical `ListBuckets` calls per account.

Regions come from `INVENTORY_REGIONS` (comma-separated), falling back to `COMMERCIAL_INVENTORY_REGIONS` in `backend-runtime/src/constants/InventoryRegions.ts` (29 regions) when empty. An explicit list rather than `ec2:DescribeRegions`, because discovery would be a **breaking IAM change**: every existing assumed-role policy grants only what the collectors read today. The list is normalised, because each raw form is a silent misconfiguration: whitespace requests a non-existent endpoint, an empty entry an unsigned request to the service root, a duplicate multiplies the API calls per account.

## Pruning keys on completeness, not on "did not throw"

A type is prunable **only when every configured region it was asked to read succeeded** — for a non-regional type, `regions.length` is expected to be 1. This is stricter than "the collector returned": under a per-region sweep, a role denied in `eu-west-1` must not prune the account's entire multi-region inventory down to the 28 regions it could still read. An empty-but-successful region is a real answer ("this account has none") and counts as read; a failed one does not. The failure reason is carried through so the task logs _which_ region was unreadable.

## A collector must never read one page and call it the whole list

`paginate` is a Template step on `BaseAwsCollector`. EC2 caps `DescribeInstances` at 1000 instances, Lambda at 1000 functions, RDS and DynamoDB at 100 — and because the task _prunes_ on success, an account above those thresholds had its inventory permanently capped: the first run stored a page, each later run deleted everything beyond it and re-added the same page.

Each service spells the protocol differently — EC2/RDS use Query parameters, Lambda a `Marker` query parameter, DynamoDB an `ExclusiveStartTableName` body field, and S3 the V2 `NextContinuationToken` because the V1 listing cannot be paginated at all — which is why `paginate` takes `fetchPage` and `readNextToken` from the caller rather than inferring them.

**A truncated walk throws; it does not return what it gathered.** A repeated continuation token or `MAX_COLLECTION_PAGES` (50) raises `AwsCollectionError` rather than `break`-ing out with a short list — otherwise the task counts the region as succeeded and `deleteStaleResources` prunes every row past the page it happened to reach. A region that cannot be read completely must count as a region that was not read.

Tests: `test/collectors/CollectorPagination.test.ts`, `test/collectors/MultiRegionSweep.test.ts`.

## Query parameters ride in the form-encoded body

`awsQueryRequest` in `provider-clients/aws/AwsSignedFetcher.ts` builds every `StsClient`, `IamClient`, `Ec2Collector` and `RdsCollector` request, and puts the parameters in the form-encoded body rather than the query string. AWS accepts either placement, which is exactly why the query-string form shipped without complaint — but the body is the only placement LocalStack-compatible emulators read, and those are what catch a drifted request shape. See [`../testing/AGENTS.md`](../../testing/AGENTS.md) for the Floci tier.

## DynamoDB has no emulator coverage

Floci answers `404 UnknownOperationException` for both `DynamoDB_20120810.ListTables` and `CreateTable`, so no request shape we can send reaches `DynamoDbCollector`. Its parsing is covered by the stubbed suite; revisit when the emulator lands those targets.
