-- Personal access tokens are stored as SHA-256 digests, never plaintext.
--
-- Why: a read or backup of D1 handed live bearer credentials to anyone who
-- could read the row. The tokens are 244 random bits from two UUIDs, so a
-- single-round SHA-256 is sufficient — no salt, no password KDF, the input
-- space is not dictionary-searchable.
--
-- There is no SQL-side way to hash a row retroactively, so existing tokens
-- cannot be upgraded in place. The trade-off is taken deliberately: every
-- existing token stops authenticating and must be re-issued (force re-issue).
-- That is a self-service operation: the user mints a new token from the
-- profile page. Tokens are short-lived (<= 90 days) and few (<= 5 per user),
-- and every authenticated request would have carried a live credential in the
-- backup until checksums replaced them.

-- Force re-issue: the plaintext digests are deliberately dropped with the
-- column, so no row from the old world survives.
DELETE FROM user_access_tokens;

ALTER TABLE user_access_tokens DROP COLUMN access_token;

ALTER TABLE user_access_tokens ADD COLUMN token_hash VARCHAR(64) NOT NULL DEFAULT '';

-- The authentication lookup is a full equality match on a 64-hex digest, so a
-- unique index replaces the unindexed plaintext scan outright.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_access_tokens_token_hash ON user_access_tokens(token_hash);
