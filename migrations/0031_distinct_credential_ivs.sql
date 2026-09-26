-- Give every encrypted credential field its own AES-GCM IV.
--
-- `CredentialsDAO.storeCredential` previously encrypted accessKeyId,
-- secretAccessKey and sessionToken under one key with a single shared IV,
-- storing that IV in `salt`. GCM nonce reuse is a critical flaw: the CTR
-- keystream is identical across the three encryptions, so XORing any two
-- ciphertexts yields the XOR of their plaintexts (and the `AKIA`/`ASIA`
-- prefix of an access key id is well known, leaking much of the secret), and
-- the GHASH authentication subkey `H` can be recovered, enabling forgery.
--
-- Writes always populate all three columns. Rows written before this migration
-- have only `salt`; reads fall back to it, so no backfill is required and old
-- rows are re-encrypted with distinct IVs on their next write.

ALTER TABLE credentials ADD COLUMN salt_secret_access_key VARCHAR(128);
ALTER TABLE credentials ADD COLUMN salt_session_token VARCHAR(128);
