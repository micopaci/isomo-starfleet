-- Canonical laptop identity and auditable Starlink signal identity.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS serial_normalized TEXT;

UPDATE devices
SET serial_normalized = CASE
  WHEN UPPER(REGEXP_REPLACE(TRIM(COALESCE(windows_sn, '')), '\s+', '', 'g')) IN (
    '', '0', '00000000', 'DEFAULTSTRING', 'NONE', 'NULL', 'N/A', 'NA',
    'SYSTEMSERIALNUMBER', 'TOBEFILLEDBYO.E.M.', 'TOBEFILLEDBYOEM', 'UNKNOWN'
  ) THEN NULL
  ELSE UPPER(REGEXP_REPLACE(TRIM(windows_sn), '\s+', '', 'g'))
END
WHERE serial_normalized IS NULL
  AND windows_sn IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_devices_serial_normalized
  ON devices(serial_normalized)
  WHERE serial_normalized IS NOT NULL;

ALTER TABLE signal_readings
  ADD COLUMN IF NOT EXISTS starlink_id TEXT,
  ADD COLUMN IF NOT EXISTS starlink_uuid TEXT,
  ADD COLUMN IF NOT EXISTS starlink_sn TEXT,
  ADD COLUMN IF NOT EXISTS kit_id TEXT;

CREATE INDEX IF NOT EXISTS idx_signal_readings_starlink_uuid
  ON signal_readings(LOWER(starlink_uuid))
  WHERE starlink_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_readings_kit_id
  ON signal_readings(LOWER(kit_id))
  WHERE kit_id IS NOT NULL;
