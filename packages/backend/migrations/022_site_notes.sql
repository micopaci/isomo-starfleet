CREATE TABLE IF NOT EXISTS site_notes (
  id         SERIAL PRIMARY KEY,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_notes_site_id    ON site_notes(site_id);
CREATE INDEX IF NOT EXISTS idx_site_notes_created_at ON site_notes(created_at DESC);
