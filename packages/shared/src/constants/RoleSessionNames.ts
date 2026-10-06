export const ROLE_SESSION_NAME_PREFIX: string = 'AccessBridge-';
export const INTERMEDIATE_ROLE_SESSION_NAME: string = `${ROLE_SESSION_NAME_PREFIX}Intermediate`;
export const CREDENTIAL_CACHE_REFRESH_ROLE_SESSION_NAME: string = `${ROLE_SESSION_NAME_PREFIX}CredentialCacheRefresh`;
/**
 * Named for the operation rather than the caller.
 *
 * A session name is the label an operator sees in CloudTrail and IAM role
 * session history, so it is the only clue distinguishing an interactive assume-role
 * from a background collection run. Four call sites hardcoded their own
 * `AccessBridge-` string instead of deriving from the prefix, which is why the
 * convention existed but was only half-applied: a rename would have missed them.
 */
export const ROLE_DISCOVERY_ROLE_SESSION_NAME: string = `${ROLE_SESSION_NAME_PREFIX}RoleDiscovery`;
export const CHAIN_TEST_ROLE_SESSION_NAME: string = `${ROLE_SESSION_NAME_PREFIX}ChainTest`;
export const COST_COLLECTION_ROLE_SESSION_NAME: string = `${ROLE_SESSION_NAME_PREFIX}CostCollection`;
export const RESOURCE_COLLECTION_ROLE_SESSION_NAME: string = `${ROLE_SESSION_NAME_PREFIX}ResourceCollection`;
