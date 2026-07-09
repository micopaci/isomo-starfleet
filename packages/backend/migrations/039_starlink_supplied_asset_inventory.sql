-- Migration 039: Add operator-supplied Starlink asset identities.
--
-- These kit/serial/UUID records came from the fleet operator after the portal
-- sync identified kit-only inventory gaps. They are not discoverable from the
-- Starlink service-line feed alone.

ALTER TABLE starlink_retired_assets
  ADD COLUMN IF NOT EXISTS starlink_uuid TEXT;

-- GS St Mathieu - Busasamana has a replacement kit identity. Keep the site row
-- current and move the previous kit into retired history.
WITH st_mathieu AS (
  UPDATE sites
  SET kit_id = 'KIT303533731',
      starlink_sn = '2DWC240500021645',
      starlink_uuid = '01000000-00000000-0070638a'
  WHERE name = 'GS St Mathieu - Busasamana'
  RETURNING id
)
INSERT INTO starlink_retired_assets (
  site_id,
  site_name,
  starlink_sn,
  starlink_uuid,
  kit_id,
  service_line_id,
  account_id,
  status,
  decommission_reason,
  replacement_kit_id,
  metadata
)
SELECT
  id,
  'DISABLED BUSASAMANA',
  '2DWC240500008747',
  '01000000-00000000-00c1f0ec',
  'KIT303533711',
  'SL-596751-62929-38',
  'ACC-4002603-73895-12',
  'replaced',
  'DISABLED BUSASAMANA; superseded by KIT303533731',
  'KIT303533731',
  jsonb_build_object('source', 'migration_039', 'operator_account', 'Liliane Umutoni')
FROM st_mathieu
ON CONFLICT (kit_id) DO UPDATE
SET site_id = EXCLUDED.site_id,
    site_name = EXCLUDED.site_name,
    starlink_sn = EXCLUDED.starlink_sn,
    starlink_uuid = EXCLUDED.starlink_uuid,
    service_line_id = EXCLUDED.service_line_id,
    account_id = EXCLUDED.account_id,
    status = EXCLUDED.status,
    decommission_reason = EXCLUDED.decommission_reason,
    replacement_kit_id = EXCLUDED.replacement_kit_id,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

INSERT INTO starlink_retired_assets (
  site_name,
  starlink_sn,
  starlink_uuid,
  kit_id,
  account_id,
  status,
  decommission_reason,
  metadata
)
VALUES
  (
    'REPLACEMENT ON THE WAY',
    'M1HT02210491GT9',
    '01800a1b-00e07c1c-597522de',
    'KIT4M02111390XHN',
    'ACC-DF-9562628-79172-12',
    'unknown',
    'REPLACEMENT ON THE WAY',
    jsonb_build_object('source', 'migration_039', 'operator_account', 'Thierry Maniragaba')
  ),
  (
    'OLD MARANYUNDO GIRLS - DEAD',
    'M1HT02217445RMW',
    '20608784-4040591c-19619b37',
    'KIT4M02111171FR2',
    'ACC-DF-9562628-79172-12',
    'decommissioned',
    'DEAD',
    jsonb_build_object('source', 'migration_039', 'operator_account', 'Thierry Maniragaba')
  ),
  (
    'OLD NYAGASAMBU - DEAD',
    'M1HT04042076PQV',
    '21609f81-45813003-993219cf',
    'KIT4M03915869NZF',
    'ACC-DF-9562628-79172-12',
    'decommissioned',
    'DEAD',
    jsonb_build_object('source', 'migration_039', 'operator_account', 'Thierry Maniragaba')
  )
ON CONFLICT (kit_id) DO UPDATE
SET site_name = EXCLUDED.site_name,
    starlink_sn = EXCLUDED.starlink_sn,
    starlink_uuid = EXCLUDED.starlink_uuid,
    account_id = EXCLUDED.account_id,
    status = EXCLUDED.status,
    decommission_reason = EXCLUDED.decommission_reason,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();
