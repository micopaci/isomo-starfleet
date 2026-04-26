-- Migration 020 — Intune inventory/status sync + agent disk SMART health

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS os TEXT,
  ADD COLUMN IF NOT EXISTS os_version TEXT,
  ADD COLUMN IF NOT EXISTS intune_last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intune_enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compliance_state TEXT,
  ADD COLUMN IF NOT EXISTS user_principal_name TEXT,
  ADD COLUMN IF NOT EXISTS azure_ad_device_id TEXT,
  ADD COLUMN IF NOT EXISTS device_category TEXT,
  ADD COLUMN IF NOT EXISTS free_storage_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS total_storage_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS intune_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_devices_intune_last_sync_at
  ON devices(intune_last_sync_at);

CREATE INDEX IF NOT EXISTS idx_devices_user_principal_name
  ON devices(user_principal_name);

ALTER TABLE device_health
  ADD COLUMN IF NOT EXISTS disk_usage_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS disk_smart_status TEXT,
  ADD COLUMN IF NOT EXISTS disk_smart_predict_failure BOOLEAN,
  ADD COLUMN IF NOT EXISTS disk_media_type TEXT;

CREATE OR REPLACE VIEW site_uptime_today AS
SELECT
  d.site_id,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE
      (
        COUNT(*) FILTER (
          WHERE COALESCE(d.intune_last_sync_at, d.last_seen) >= NOW() - INTERVAL '9 hours'
        )
      )::NUMERIC / COUNT(*)::NUMERIC * 100.0
  END AS uptime_pct
FROM devices d
GROUP BY d.site_id;
