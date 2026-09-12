# Resource Inventory

Scope: EC2/S3/Lambda/RDS/DynamoDB discovery. Parent index: `../../../AGENTS.md`.

`ResourceInventoryCollectionTask` (phase 2, 2 accounts/invocation) fans out per service (`AwsApiUtil.describeInstances`, `listBuckets`, `listFunctions`, `describeDBInstances`, `listTables`), upserts into `resource_inventory` (`ResourceInventoryDAO`), then deletes stale rows per type. Read surface: `GET /user/resources` (filters) + `GET /user/resources/summary`. Frontend: `ResourceInventory` in `apps/web` (console deep-links per resource type).
