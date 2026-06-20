-- Migration 036: Track decommission metadata for retired Starlink terminals.
--
-- When a service line is permanently retired (not merely suspended), operators
-- need a record of WHEN it was decommissioned and WHY. These columns back the
-- dedicated "Decommissioned" view. They are independent of current_status; a
-- terminal is considered decommissioned when decommissioned_at IS NOT NULL.

ALTER TABLE starlink_terminals
  ADD COLUMN IF NOT EXISTS decommissioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decommission_reason TEXT;

-- ROLLBACK:
-- ALTER TABLE starlink_terminals
--   DROP COLUMN IF EXISTS decommissioned_at,
--   DROP COLUMN IF EXISTS decommission_reason;
