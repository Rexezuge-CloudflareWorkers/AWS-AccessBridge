export const DURABLE_OBJECT_NAMESPACE_GLOBAL: string = 'global';

/**
 * The URL `AccessBridgeWorker` posts to when the cron trigger fires.
 *
 * The host is deliberately unresolvable: `cronTasksStub.fetch` dispatches
 * straight to the Durable Object without consulting DNS, so the hostname only
 * has to be a well-formed, distinguishable placeholder. It is spelled out here
 * in one expression rather than derived from named intermediates, since the
 * intermediate names had no consumer other than each other.
 */
export const DURABLE_OBJECT_CRON_TASKS_RUN_URL: string = 'https://cron-tasks.invalid/run';
