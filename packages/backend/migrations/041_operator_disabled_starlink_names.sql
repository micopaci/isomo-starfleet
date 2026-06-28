-- Migration 041: Apply operator-confirmed disabled/broken Starlink labels.
--
-- The portal exposes disabled/broken labels by service line, but old kits also
-- need explicit kit/account bindings so retired inventory and reports do not
-- attach stale service-line state to replacement kits.

UPDATE starlink_retired_assets
SET site_id = NULL,
    site_name = 'BROKEN MOTOR',
    service_line_id = 'AST-2688211-29467-54',
    account_id = 'ACC-3049739-23188-22',
    status = 'decommissioned',
    decommission_reason = 'BROKEN MOTOR',
    replacement_kit_id = NULL,
    metadata = metadata || jsonb_build_object(
      'operator_account', 'Chaste Niwe',
      'name_source', 'operator_confirmation',
      'name_updated_by', 'migration_041'
    ),
    updated_at = NOW()
WHERE kit_id = 'KIT302394513';

UPDATE starlink_retired_assets
SET site_name = 'DISABLED BUSASAMANA',
    service_line_id = 'SL-596751-62929-38',
    account_id = 'ACC-4002603-73895-12',
    status = 'replaced',
    decommission_reason = 'DISABLED BUSASAMANA; superseded by KIT303533731',
    replacement_kit_id = 'KIT303533731',
    metadata = metadata || jsonb_build_object(
      'operator_account', 'Liliane Umutoni',
      'name_source', 'operator_confirmation',
      'name_updated_by', 'migration_041'
    ),
    updated_at = NOW()
WHERE kit_id = 'KIT303533711';

UPDATE starlink_terminals
SET site_id = NULL,
    account_id = 'ACC-3049739-23188-22',
    nickname = 'BROKEN MOTOR',
    current_status = 'Inactive',
    updated_at = NOW()
WHERE service_line_id = 'AST-2688211-29467-54';

UPDATE starlink_terminals
SET site_id = NULL,
    account_id = 'ACC-4002603-73895-12',
    nickname = 'DISABLED BUSASAMANA',
    current_status = 'Inactive',
    decommissioned_at = COALESCE(decommissioned_at, NOW()),
    decommission_reason = COALESCE(decommission_reason, 'DISABLED BUSASAMANA; superseded by KIT303533731'),
    updated_at = NOW()
WHERE service_line_id = 'SL-596751-62929-38';

UPDATE starlink_terminals
SET account_id = 'ACC-3049739-23188-22',
    nickname = 'DISABLED - GS Kinigi - G3',
    current_status = 'Inactive',
    updated_at = NOW()
WHERE service_line_id = 'SL-DF-9515103-35769-62';
