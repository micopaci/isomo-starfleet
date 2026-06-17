-- Migration 035: Add 'Inactive' to starlink_terminals.current_status allowed values.
--
-- Disabled/suspended Starlink service lines should be stored with
-- current_status = 'Inactive' so they remain visible in the dashboard
-- (with a distinct visual treatment) without counting toward fleet health
-- metrics or usage reports.

ALTER TABLE starlink_terminals
  DROP CONSTRAINT starlink_terminals_current_status_check,
  ADD CONSTRAINT starlink_terminals_current_status_check
    CHECK (current_status IN ('Online', 'Offline', 'Unknown', 'Inactive'));

-- ROLLBACK:
-- ALTER TABLE starlink_terminals
--   DROP CONSTRAINT starlink_terminals_current_status_check,
--   ADD CONSTRAINT starlink_terminals_current_status_check
--     CHECK (current_status IN ('Online', 'Offline', 'Unknown'));
