-- Migration 021 — widen Intune-first laptop health window

CREATE OR REPLACE VIEW site_uptime_today AS
SELECT
  d.site_id,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE
      (
        COUNT(*) FILTER (
          WHERE GREATEST(d.intune_last_sync_at, d.last_seen) >= NOW() - INTERVAL '72 hours'
        )
      )::NUMERIC / COUNT(*)::NUMERIC * 100.0
  END AS uptime_pct
FROM devices d
GROUP BY d.site_id;
