-- Migration 018 - Optional Starlink UUID lookup for agent site resolution
--
-- Some Starlink diagnostics expose a terminal/dish identifier that can be
-- matched to the fleet inventory when GPS is unavailable. Keep this nullable so
-- existing site rows remain valid, and enforce case-insensitive uniqueness only
-- when values are present.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS starlink_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_starlink_uuid_lower
  ON sites (LOWER(starlink_uuid))
  WHERE starlink_uuid IS NOT NULL;
