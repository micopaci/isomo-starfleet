CREATE TABLE IF NOT EXISTS site_biweekly_usage (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  bytes_down   BIGINT NOT NULL DEFAULT 0,
  bytes_up     BIGINT NOT NULL DEFAULT 0,
  notes        TEXT,
  entered_by   TEXT NOT NULL,
  entered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, period_start),
  CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_biweekly_usage_site_id      ON site_biweekly_usage(site_id);
CREATE INDEX IF NOT EXISTS idx_biweekly_usage_period_start ON site_biweekly_usage(period_start DESC);
