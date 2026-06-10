-- Discovery agents report site_id=0 until Starfleet can resolve a real site
-- from GPS or Starlink identity. site_id=0 is virtual and must not be stored
-- in FK-backed columns.

ALTER TABLE devices
  ALTER COLUMN site_id DROP NOT NULL;

UPDATE devices
SET site_id = NULL
WHERE site_id = 0;

ALTER TABLE agent_health_snapshots
  ALTER COLUMN site_id DROP NOT NULL;
