-- Add location and kit_id columns to sites
ALTER TABLE sites ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS kit_id   TEXT;
