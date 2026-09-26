/**
 * Manual cron trigger path, for operators who need to run the scheduled
 * pipeline on demand (e.g. after adding an account) without waiting for the
 * next tick.
 *
 * This path is handled by `AbstractEntrypointWorker.fetch` *before* the Hono
 * app, so no route middleware runs for it. It therefore runs the full
 * privileged pipeline — real AWS API calls with stored credentials, D1 writes,
 * retention pruning — and must be authorized explicitly by each worker via
 * `authorizeScheduledTrigger`, which denies by default.
 */
export const SCHEDULED_TRIGGER_PATH: string = '/__scheduled';
