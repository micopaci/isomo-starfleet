-- hostname is optional — agents may not report it for non-heartbeat calls
ALTER TABLE devices ALTER COLUMN hostname DROP NOT NULL;

-- Seed a test site for development (id will be 1 on a fresh DB)
INSERT INTO sites (name, starlink_sn)
VALUES ('Kigali-HQ', 'STR-KGL-001')
ON CONFLICT (starlink_sn) DO NOTHING;
