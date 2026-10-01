import { D1_SESSION_CONSTRAINT_FIRST_UNCONSTRAINED } from '../constants/d1';

type D1Queryable = Pick<D1Database, 'prepare' | 'batch'>;

type D1SessionEnv<TEnv extends { AccessBridgeDB: D1Database }> = Omit<TEnv, 'AccessBridgeDB'> & {
  AccessBridgeDB: D1DatabaseSession;
};

/**
 * The shape `withSession` accepts. `string` is included because the runtime's own
 * `D1SessionConstraint | D1SessionBookmark` union is already wider than the two
 * documented constraints — a caller may pass a bookmark, and narrowing it here
 * would reject a valid call.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
type SessionTarget = D1SessionBookmark | D1SessionConstraint  ;

/**
 * Replace `env.AccessBridgeDB` with a session bound to the first replica.
 *
 * Read-your-writes: a route that writes through the session and then reads back
 * through the primary would otherwise be racing D1 replication.
 *
 * The session is `first-unconstrained`, so a route that writes through it can also
 * write — which is the whole point of routing reads through a session.
 *
 * Passes `env` through unchanged when the binding has no `withSession`, so a test
 * double or a legacy binding degrades instead of throwing mid-request.
 */
function createD1SessionEnv<TEnv extends { AccessBridgeDB: D1Database }>(env: TEnv, constraint: SessionTarget = D1_SESSION_CONSTRAINT_FIRST_UNCONSTRAINED): TEnv {
  const database = env.AccessBridgeDB as { withSession?: (target: SessionTarget) => D1DatabaseSession };
  return typeof database.withSession === 'function' ? ({ ...(env as object), AccessBridgeDB: database.withSession(constraint) } as unknown as TEnv) : env;
}

export { createD1SessionEnv };
export type { D1Queryable, D1SessionEnv, SessionTarget };