type D1Queryable = Pick<D1Database, 'prepare' | 'batch'>;

type D1SessionEnv<TEnv extends { AccessBridgeDB: D1Database }> = Omit<TEnv, 'AccessBridgeDB'> & {
  AccessBridgeDB: D1DatabaseSession;
};

function createD1SessionEnv<TEnv extends { AccessBridgeDB: D1Database }>(
  env: TEnv,
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  constraintOrBookmark: D1SessionBookmark | D1SessionConstraint = 'first-primary',
): D1SessionEnv<TEnv> {
  return {
    ...env,
    AccessBridgeDB: env.AccessBridgeDB.withSession(constraintOrBookmark),
  };
}

export { createD1SessionEnv };
export type { D1Queryable, D1SessionEnv };
