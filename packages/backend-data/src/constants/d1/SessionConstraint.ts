/**
 * D1 session constraints.
 *
 * `first-unconstrained` is the only value used: it pins reads to the first
 * replica for read-your-writes while leaving the session writable, which a route
 * needs when it writes and then reads back.
 */
export const D1_SESSION_CONSTRAINT_FIRST_UNCONSTRAINED: string = 'first-unconstrained';
