-- C7 auth module: session lookup is by SHA-256 hash of the raw cookie token,
-- never by direct token equality (forbidden pattern). `sessions.id` stays the
-- row's own uuid PK; `token_hash` is the lookup key.
ALTER TABLE sessions ADD COLUMN token_hash text;
UPDATE sessions SET token_hash = encode(gen_random_bytes(32), 'hex') WHERE token_hash IS NULL;
ALTER TABLE sessions ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);
