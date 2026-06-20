-- Migration 037: Store Starlink dish alignment (boresight) from agent signal.
--
-- The Windows agent already reads boresight azimuth/elevation from the dish
-- gRPC and sends azimuth_deg/elevation_deg in /ingest/signal, but the backend
-- dropped them. These columns persist the dish's pointing direction (degrees)
-- alongside obstruction_pct so the dashboard can show alignment.

ALTER TABLE signal_readings
  ADD COLUMN IF NOT EXISTS boresight_azimuth_deg NUMERIC,
  ADD COLUMN IF NOT EXISTS boresight_elevation_deg NUMERIC;

-- ROLLBACK:
-- ALTER TABLE signal_readings
--   DROP COLUMN IF EXISTS boresight_azimuth_deg,
--   DROP COLUMN IF EXISTS boresight_elevation_deg;
