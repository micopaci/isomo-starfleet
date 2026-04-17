-- Migration 011: Stage 5 — Signal Intelligence Hardening
-- Adds weather_log table, anomaly/low_data flags on daily_scores,
-- and 7-day rolling avg on sites.

-- 1. Extend daily_scores with Stage 5 fields
ALTER TABLE daily_scores
  ADD COLUMN IF NOT EXISTS data_quality  TEXT DEFAULT 'ok',   -- 'ok' | 'low_data'
  ADD COLUMN IF NOT EXISTS anomaly       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anomaly_delta INT;                  -- score drop vs 7-day avg

-- 2. Weather correlation log (Open-Meteo, best-effort)
CREATE TABLE IF NOT EXISTS weather_log (
  id             SERIAL PRIMARY KEY,
  site_id        INT REFERENCES sites(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  rainfall_mm    FLOAT,
  cloud_cover_pct FLOAT,
  UNIQUE(site_id, date)
);
CREATE INDEX IF NOT EXISTS idx_weather_site_date ON weather_log(site_id, date);

-- 3. 7-day rolling score average on sites
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS score_7day_avg FLOAT;

-- 4. Stale device tracking index (watchdog needs this to be fast)
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
