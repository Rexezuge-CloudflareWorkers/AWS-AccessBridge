# Cost Analytics + Spend Alerts

Scope: Cost Explorer collection, dashboards, alerts. Parent index: `../../../AGENTS.md`.

`CostDataCollectionTask` (phase 2) calls `AwsApiUtil.getCostAndUsage` (Cost Explorer, 30-day daily lookback, 3 accounts/invocation) for credentials enabled in `data_collection_config`; results upsert into `cost_data` (`CostDataDAO`). Spend thresholds live in `spend_alerts` (`SpendAlertDAO`). Read surface: `GET /user/costs/summary|account|trends`; admin surface: `…/costs/alerts` (POST/DELETE), `…/collection/config` (POST/DELETE). Frontend: `CostDashboard` in `apps/web`.
