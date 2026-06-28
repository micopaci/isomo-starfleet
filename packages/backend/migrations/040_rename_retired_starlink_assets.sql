-- Migration 040: Rename retired Starlink kits after operator confirmation.
--
-- Migration 039 first captured these two Thierry assets with the generic
-- portal label "DEAD". The operator later confirmed the original site names.

UPDATE starlink_retired_assets
SET site_name = CASE kit_id
      WHEN 'KIT4M02111171FR2' THEN 'OLD MARANYUNDO GIRLS - DEAD'
      WHEN 'KIT4M03915869NZF' THEN 'OLD NYAGASAMBU - DEAD'
      ELSE site_name
    END,
    metadata = metadata || jsonb_build_object(
      'name_source', 'operator_confirmation',
      'name_updated_by', 'migration_040'
    ),
    updated_at = NOW()
WHERE kit_id IN ('KIT4M02111171FR2', 'KIT4M03915869NZF');
