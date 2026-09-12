# Resource Inventory

Scope: EC2/S3/Lambda/RDS/DynamoDB discovery. Parent index: `../../../AGENTS.md`.

`ResourceInventoryCollectionTask` (phase 2, 2 accounts/invocation) fans out over every `CollectorRegistry` collector (`Ec2/S3/Lambda/Rds/DynamoDbCollector.collect`), upserts into `resource_inventory` (`ResourceInventoryDAO`), then deletes stale rows per registered type. Read surface: `GET /user/resources` (filters) + `GET /user/resources/summary` (via `ResourceService`). Frontend: `ResourceInventory` in `apps/web` (console deep-links per resource type).
