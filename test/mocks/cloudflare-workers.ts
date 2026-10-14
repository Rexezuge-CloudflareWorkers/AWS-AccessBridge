/**
 * The `cloudflare:workers` stand-in for the unit suite.
 *
 * A re-export of the kit's, because the union of every class a
 * `@rexezuge/runtime` subclass may extend lives there — `DurableObject`,
 * `RpcTarget` and `WorkflowEntrypoint`. This file used to be a local copy that
 * exported only the first, which was enough until 1.7.1 made
 * `AbstractWorkflowWorker` extend the real `WorkflowEntrypoint`: after which the
 * runtime barrel failed to evaluate with "Class extends value undefined",
 * taking down every suite that imported it for a reason that had nothing to do
 * with workflows.
 *
 * It exists at this path rather than being deleted because
 * `defineRepoVitestConfig` resolves the mock as `<root>/test/mocks/cloudflare-<name>.ts`.
 * A shim that says *where the good one lives* is the right answer to a factory
 * that expects a path: the copy cannot drift back into being partial, because
 * there is nothing left here to drift.
 */
export * from '@rexezuge/tooling/test/mocks/cloudflare-workers';
