-- Migration 038: Track retired Starlink kit assets and correct known kit IDs.
--
-- Starlink portal inventory is service-line keyed, but kit replacements can
-- leave an old KIT number with no active service line. Keep those retired kits
-- in their own asset table so the Decommissioned view can show them without
-- marking the replacement service line inactive.

CREATE TABLE IF NOT EXISTS starlink_retired_assets (
  id                 BIGSERIAL PRIMARY KEY,
  site_id            INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  site_name          TEXT NOT NULL,
  starlink_sn        TEXT,
  kit_id             TEXT NOT NULL UNIQUE,
  service_line_id    TEXT,
  account_id         TEXT,
  status             TEXT NOT NULL DEFAULT 'decommissioned'
                     CHECK (status IN ('decommissioned', 'retired', 'replaced', 'unknown')),
  decommissioned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decommission_reason TEXT,
  replacement_kit_id TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_starlink_retired_assets_site_id
  ON starlink_retired_assets(site_id)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_starlink_retired_assets_decommissioned_at
  ON starlink_retired_assets(decommissioned_at DESC);

-- Clear one-character/spacing mismatches where the existing site/service-line
-- match is unambiguous from portal inventory and Starfleet site identity.
WITH kit_updates(starlink_sn, kit_id) AS (
  VALUES
    ('M1HT022172551989', 'KIT4M021113538JR'),
    ('M1HT022175928W4R', 'KIT4M021113942MS'),
    ('M1HT022173327VVS', 'KIT4M021110448QS'),
    ('M1HT022020050GD6', 'KIT4M021111818JX'),
    ('4PBA04570677PZN', 'KIT404586207Z4D'),
    ('4PBA04568913KHC', 'KIT4045845655CD'),
    ('4PBA045711842XF', 'KIT4045867657VH')
)
UPDATE sites s
SET kit_id = u.kit_id
FROM kit_updates u
WHERE s.starlink_sn = u.starlink_sn;

-- Re-add the broken motor kit to decommissioned inventory without touching the
-- active replacement ES Juru service line.
INSERT INTO starlink_retired_assets (
  site_name,
  starlink_sn,
  kit_id,
  service_line_id,
  account_id,
  status,
  decommission_reason,
  metadata
)
VALUES (
  'BROKEN MOTOR',
  '2DUNI00000100892',
  'KIT302394513',
  'AST-2688211-29467-54',
  'ACC-3049739-23188-22',
  'decommissioned',
  'BROKEN MOTOR',
  jsonb_build_object('source', 'migration_038', 'operator_account', 'Chaste Niwe')
)
ON CONFLICT (kit_id) DO UPDATE
SET site_id = NULL,
    site_name = EXCLUDED.site_name,
    starlink_sn = EXCLUDED.starlink_sn,
    service_line_id = EXCLUDED.service_line_id,
    account_id = EXCLUDED.account_id,
    status = EXCLUDED.status,
    decommission_reason = EXCLUDED.decommission_reason,
    replacement_kit_id = NULL,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();
