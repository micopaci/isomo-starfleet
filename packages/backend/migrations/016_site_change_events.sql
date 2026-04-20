-- Migration 016 — audit log for automatic site reassignment.
-- When a laptop's reported lat/lon resolves to a site different from its current
-- devices.site_id, we insert a row here and fire email + FCM.

CREATE TABLE IF NOT EXISTS site_change_events (
  id             SERIAL PRIMARY KEY,
  device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  from_site_id   INTEGER          REFERENCES sites(id),    -- NULL on first registration
  to_site_id     INTEGER NOT NULL REFERENCES sites(id),
  reported_lat   NUMERIC NOT NULL,
  reported_lon   NUMERIC NOT NULL,
  distance_km    NUMERIC NOT NULL,  -- distance from to_site's GPS
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at    TIMESTAMPTZ,       -- set when email + FCM fanned out
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_site_change_events_device_id
  ON site_change_events(device_id);
CREATE INDEX IF NOT EXISTS idx_site_change_events_detected_at
  ON site_change_events(detected_at);
CREATE INDEX IF NOT EXISTS idx_site_change_events_unack
  ON site_change_events(acknowledged_at) WHERE acknowledged_at IS NULL;

-- Track last reported coords on device for display + debugging.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS last_lat       NUMERIC,
  ADD COLUMN IF NOT EXISTS last_lon       NUMERIC,
  ADD COLUMN IF NOT EXISTS last_gps_at    TIMESTAMPTZ;

-- User notification preferences (per-user opt-outs for this specific event type).
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  site_change_email BOOLEAN NOT NULL DEFAULT TRUE,
  site_change_push  BOOLEAN NOT NULL DEFAULT TRUE,
  site_down_email   BOOLEAN NOT NULL DEFAULT TRUE,
  site_down_push    BOOLEAN NOT NULL DEFAULT TRUE
);
