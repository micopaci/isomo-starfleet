-- Migration 042: Keep disabled Busasamana service line out of live outage flow.
--
-- The old Busasamana service line belongs to retired KIT303533711, not the
-- replacement KIT303533731. Mark it decommissioned so portal re-feeds preserve
-- its name/last-seen evidence without creating active offline alerts.

UPDATE starlink_terminals
SET site_id = NULL,
    account_id = 'ACC-4002603-73895-12',
    nickname = COALESCE(NULLIF(TRIM(nickname), ''), 'DISABLED BUSASAMANA'),
    current_status = 'Inactive',
    decommissioned_at = COALESCE(decommissioned_at, NOW()),
    decommission_reason = COALESCE(decommission_reason, 'DISABLED BUSASAMANA; superseded by KIT303533731'),
    updated_at = NOW()
WHERE service_line_id = 'SL-596751-62929-38';

UPDATE alert_events
SET status = 'resolved',
    resolved_at = NOW()
WHERE source_type = 'starlink_portal'
  AND source_id = 'SL-596751-62929-38'
  AND status = 'open';
