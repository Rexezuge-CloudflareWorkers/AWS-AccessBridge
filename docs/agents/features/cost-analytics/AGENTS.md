# Cost Analytics + Spend Alerts

Scope: Cost Explorer collection, the read surface, and what a spend alert currently is. Parent index: [`../../../../AGENTS.md`](../../../../AGENTS.md).

## Collection

`CostDataCollectionTask` (cron phase 2) extends `AbstractCollectionTask`, which supplies the whole shape: pick the principals due for collection (`getPrincipalArnsNeedingCollection`, bounded by `COST_COLLECTION_INTERVAL_HOURS`), resolve leaf credentials for each, call `collectForAccount`, then advance `last_collected_at` — **only when the account reported data**. The **attempt** clock (`last_attempt_at`) is stamped on every attempt and the due query orders on it, so a failing or empty account is retried on the next interval rather than in a tight loop or ahead of the accounts behind it.

Three accounts per invocation. Lookback is `COST_LOOKBACK_DAYS` (default 30), daily granularity, period `COST_COLLECTION_INTERVAL_HOURS` (default 6). The session name is the shared `COST_COLLECTION_ROLE_SESSION_NAME` constant. Results upsert into `cost_data` via `CostDataDAO`, keyed `(account, period_start)` with `INSERT OR REPLACE`. Which principals collect at all is `data_collection_config`, toggled through `POST|DELETE /user/admin/collection/config`.

## `GetCostAndUsage` is followed to exhaustion, and merged per period

Both halves of this were spend bugs, and both were invisible because a partial response is a well-formed response.

**Pagination.** `NextPageToken` is followed until absent; omitting it reported spend _below_ the account's actual figure, so a threshold set near the real number could be missed indefinitely. A repeated token stops the walk and logs rather than re-fetching one page until the request's wall-clock limit.

**Merging.** Pages are accumulated **per period**, not emitted per page. `GetCostAndUsage` can split one period's service groups across pages, so a period may arrive more than once; emitting one result per arrival would let `INSERT OR REPLACE` store only the last page's cost for that period. The accumulator lives in `provider-clients/aws/CostExplorerClient.ts`, and the parsed total is `MoneyUtil.round(...)` while the per-service breakdown amounts stay unrounded — a change to `MoneyUtil` therefore surfaces as a contract change in the Floci suite, which restates the expected value rather than importing it.

Groups at or below zero are dropped, so a positive-amount assertion has to seed a real figure: a bucket with nothing in it reports `0.0000000000`.

## Reading

`GET /user/costs/summary` · `GET /user/costs/account` · `GET /user/costs/trends`, all through `CostService`, all scoped to the caller's own accounts via `AssumableRolesDAO`. Frontend: `CostDashboard` in `apps/web`.

`getSummary` tracks **currency agreement** across every account: the first currency seen is remembered, and the first disagreement sticks the whole summary to `null` — a later EUR row must not un-decide an earlier USD one. A sum silently spanning currencies is arithmetically meaningless, so `null` is the honest answer, and the SPA renders it as a symbol-less "mixed currency" figure (`formatAmount`).

## A spend alert is stored, not evaluated

`spend_alerts` rows are created (`POST /user/admin/costs/alerts`) and deleted (`DELETE …/alerts`) through `CostService`. **Nothing evaluates a threshold and nothing notifies.** There is no alert evaluator in either cron phase, and `SpendAlertDAO` has no read method at all (the two it once had were called from tests only, so they were deleted). A threshold crossing produces no event, no log line, and no message anywhere.

The `SpendAlertsTab` copy ("alerts are evaluated against cost data collected in the background") describes intended behaviour, and it is the one place in the repository that claims something the code does not do. Treat an alert as configuration awaiting an evaluator: adding one means a new phase-2 task, with a new `SpendAlertDAO` read method comparing alerts against the freshly collected `cost_data`, plus a notification channel that does not exist yet. Until then, the honest consumer of spend is the dashboard, not the alert table.
