require('dotenv').config();
const pool = require('../db');

const PLACEHOLDERS = [
  '',
  '0',
  '00000000',
  'DEFAULTSTRING',
  'NONE',
  'NULL',
  'N/A',
  'NA',
  'SYSTEMSERIALNUMBER',
  'TOBEFILLEDBYO.E.M.',
  'TOBEFILLEDBYOEM',
  'UNKNOWN',
];

async function main() {
  const { rows } = await pool.query(
    `WITH normalized AS (
       SELECT id, hostname, windows_sn, serial_normalized, intune_device_id, site_id,
              last_seen, intune_last_sync_at,
              COALESCE(
                serial_normalized,
                UPPER(REGEXP_REPLACE(TRIM(COALESCE(windows_sn, '')), '\\s+', '', 'g'))
              ) AS serial_norm
       FROM devices
     )
     SELECT serial_norm,
            COUNT(*)::INT AS row_count,
            COUNT(*) FILTER (WHERE intune_device_id IS NOT NULL)::INT AS intune_rows,
            MAX(GREATEST(
              COALESCE(last_seen, 'epoch'::TIMESTAMPTZ),
              COALESCE(intune_last_sync_at, 'epoch'::TIMESTAMPTZ)
            )) AS latest_seen,
            JSON_AGG(JSON_BUILD_OBJECT(
              'id', id,
              'hostname', hostname,
              'windows_sn', windows_sn,
              'serial_normalized', serial_normalized,
              'intune_device_id', intune_device_id,
              'site_id', site_id,
              'last_seen', last_seen,
              'intune_last_sync_at', intune_last_sync_at
            ) ORDER BY id) AS devices
     FROM normalized
     WHERE serial_norm IS NOT NULL
       AND serial_norm <> ALL($1::TEXT[])
     GROUP BY serial_norm
     HAVING COUNT(*) > 1
     ORDER BY latest_seen DESC NULLS LAST, row_count DESC, serial_norm`,
    [PLACEHOLDERS]
  );

  console.log(JSON.stringify({
    duplicate_serial_group_count: rows.length,
    duplicate_serial_groups: rows,
  }, null, 2));
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
