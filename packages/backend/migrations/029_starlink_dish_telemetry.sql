-- Capture generation-compatible Starlink dish telemetry from local agent status probes.

ALTER TABLE signal_readings
  ADD COLUMN IF NOT EXISTS is_snr_above_noise_floor BOOLEAN,
  ADD COLUMN IF NOT EXISTS starlink_alerts JSONB,
  ADD COLUMN IF NOT EXISTS disablement_code TEXT,
  ADD COLUMN IF NOT EXISTS ready_states JSONB,
  ADD COLUMN IF NOT EXISTS dl_bandwidth_restricted_reason TEXT,
  ADD COLUMN IF NOT EXISTS ul_bandwidth_restricted_reason TEXT,
  ADD COLUMN IF NOT EXISTS dish_uptime_s BIGINT,
  ADD COLUMN IF NOT EXISTS dish_bootcount INTEGER,
  ADD COLUMN IF NOT EXISTS dish_grpc_reachable BOOLEAN,
  ADD COLUMN IF NOT EXISTS starlink_power_verdict TEXT;

CREATE INDEX IF NOT EXISTS idx_signal_readings_dish_grpc_reachable
  ON signal_readings(dish_grpc_reachable)
  WHERE dish_grpc_reachable IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_readings_power_verdict
  ON signal_readings(starlink_power_verdict)
  WHERE starlink_power_verdict IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_signal_readings_power_verdict;
-- DROP INDEX IF EXISTS idx_signal_readings_dish_grpc_reachable;
-- ALTER TABLE signal_readings
--   DROP COLUMN IF EXISTS is_snr_above_noise_floor,
--   DROP COLUMN IF EXISTS starlink_alerts,
--   DROP COLUMN IF EXISTS disablement_code,
--   DROP COLUMN IF EXISTS ready_states,
--   DROP COLUMN IF EXISTS dl_bandwidth_restricted_reason,
--   DROP COLUMN IF EXISTS ul_bandwidth_restricted_reason,
--   DROP COLUMN IF EXISTS dish_uptime_s,
--   DROP COLUMN IF EXISTS dish_bootcount,
--   DROP COLUMN IF EXISTS dish_grpc_reachable,
--   DROP COLUMN IF EXISTS starlink_power_verdict;
