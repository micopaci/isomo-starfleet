-- Migration 015 — capture instantaneous throughput on each signal reading.
-- Source: Starlink gRPC `dish_get_data` → {downlink_throughput_bps, uplink_throughput_bps}.
-- Stored as Mbps for compact display + easy ranking.

ALTER TABLE signal_readings
  ADD COLUMN IF NOT EXISTS download_mbps NUMERIC,
  ADD COLUMN IF NOT EXISTS upload_mbps   NUMERIC;

-- Daily uptime % (derived): heartbeats_received / heartbeats_expected.
-- Expected = 288 (every 5 min for 24h). Kept as a view so it updates live.
CREATE OR REPLACE VIEW site_uptime_today AS
SELECT
  d.site_id,
  COUNT(*)::NUMERIC / (288.0 * COUNT(DISTINCT d.id))::NUMERIC * 100.0 AS uptime_pct
FROM devices d
LEFT JOIN signal_readings sr
  ON sr.device_id = d.id
 AND sr.recorded_at >= (NOW() AT TIME ZONE 'Africa/Kigali')::date
GROUP BY d.site_id;

-- Today's total data (MB) per site, for ranking by usage.
CREATE OR REPLACE VIEW site_data_today AS
SELECT
  site_id,
  (COALESCE(SUM(bytes_down), 0) + COALESCE(SUM(bytes_up), 0)) / (1024.0 * 1024.0) AS data_mb_today
FROM data_usage
WHERE date = (NOW() AT TIME ZONE 'Africa/Kigali')::date
GROUP BY site_id;
