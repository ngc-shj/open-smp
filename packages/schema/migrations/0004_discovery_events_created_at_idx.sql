-- Chronological read path for discovery_events (C20).
--
-- The events API previously ordered by `id` (a random uuid), which was
-- tolerable for sync/match rows but meaningless for an audit trail: "show me
-- what happened, in order" is the entire point once label mutations are
-- recorded here. The composite cursor keys on (created_at, id), so the index
-- carries both columns in the scan direction the route uses.
CREATE INDEX discovery_events_tenant_created_idx
  ON discovery_events (tenant_id, created_at DESC, id DESC);
