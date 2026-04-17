-- 1. Remove test site (Kigali-HQ) and cascade its devices/readings
DELETE FROM sites WHERE starlink_sn = 'STR-KGL-001';

-- 2. Remove ES Juru duplicate — keep KIT302394513 (starlink_sn = 2DUNI00000100892),
--    delete Dish 2 (M1HT022172551989)
DELETE FROM sites WHERE starlink_sn = 'M1HT022172551989';

-- 3. Add Intune Device ID column (used by Graph API to trigger remediations)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS intune_device_id TEXT UNIQUE;

-- 4. Make site_id nullable — devices from Intune don't have a site assignment yet;
--    site_id is set when the agent first calls /ingest/heartbeat from a known site
ALTER TABLE devices ALTER COLUMN site_id DROP NOT NULL;

-- 5. Add manufacturer column
ALTER TABLE devices ADD COLUMN IF NOT EXISTS manufacturer TEXT;
