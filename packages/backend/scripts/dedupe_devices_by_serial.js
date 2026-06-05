require('dotenv').config();
const pool = require('../db');

const APPLY = process.argv.includes('--apply');
const DEPENDENT_TABLES = [
  'signal_readings',
  'latency_readings',
  'device_health',
  'data_usage',
  'script_triggers',
  'agent_health_snapshots',
  'ingest_payload_dedup',
  'site_change_events',
  'site_move_candidates',
  'alert_events',
];
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

function seenValue(row) {
  const dates = [row.last_seen, row.intune_last_sync_at, row.intune_synced_at]
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : 0;
}

function chooseCanonical(rows) {
  return [...rows].sort((a, b) => {
    const aReal = !String(a.windows_sn || '').startsWith('INTUNE-') ? 1 : 0;
    const bReal = !String(b.windows_sn || '').startsWith('INTUNE-') ? 1 : 0;
    if (aReal !== bReal) return bReal - aReal;

    const aHeartbeat = a.last_seen ? 1 : 0;
    const bHeartbeat = b.last_seen ? 1 : 0;
    if (aHeartbeat !== bHeartbeat) return bHeartbeat - aHeartbeat;

    return seenValue(b) - seenValue(a) || a.id - b.id;
  })[0];
}

function chooseIntuneSource(rows) {
  return [...rows]
    .filter(row => row.intune_device_id)
    .sort((a, b) => {
      const aSync = a.intune_last_sync_at ? new Date(a.intune_last_sync_at).getTime() : 0;
      const bSync = b.intune_last_sync_at ? new Date(b.intune_last_sync_at).getTime() : 0;
      return bSync - aSync || b.id - a.id;
    })[0] || null;
}

async function tableExists(client, table) {
  const { rows } = await client.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
  return Boolean(rows[0]?.name);
}

async function dependentCounts(client, deviceId) {
  const counts = {};
  for (const table of DEPENDENT_TABLES) {
    if (!(await tableExists(client, table))) continue;
    const { rows } = await client.query(`SELECT COUNT(*)::INT AS cnt FROM ${table} WHERE device_id = $1`, [deviceId]);
    counts[table] = rows[0].cnt;
  }
  return counts;
}

function hasDependents(counts) {
  return Object.values(counts).some(count => count > 0);
}

async function duplicateGroups(client) {
  const { rows } = await client.query(
    `WITH normalized AS (
       SELECT id, hostname, windows_sn, serial_normalized, intune_device_id, site_id,
              last_seen, intune_last_sync_at, intune_synced_at,
              manufacturer, model, os, os_version, intune_enrolled_at,
              compliance_state, user_principal_name, azure_ad_device_id,
              device_category, free_storage_bytes, total_storage_bytes,
              COALESCE(
                serial_normalized,
                UPPER(REGEXP_REPLACE(TRIM(COALESCE(windows_sn, '')), '\\s+', '', 'g'))
              ) AS serial_norm
       FROM devices
     )
     SELECT serial_norm, JSON_AGG(TO_JSONB(normalized) ORDER BY id) AS devices
     FROM normalized
     WHERE serial_norm IS NOT NULL
       AND serial_norm <> ALL($1::TEXT[])
     GROUP BY serial_norm
     HAVING COUNT(*) > 1
     ORDER BY serial_norm`,
    [PLACEHOLDERS]
  );
  return rows;
}

async function mergeGroup(client, group) {
  const rows = group.devices;
  const canonical = chooseCanonical(rows);
  const intuneSource = chooseIntuneSource(rows);
  const candidates = rows.filter(row =>
    row.id !== canonical.id &&
    String(row.windows_sn || '').startsWith('INTUNE-') &&
    !row.last_seen
  );

  const skipped = [];
  const removable = [];
  for (const row of candidates) {
    const counts = await dependentCounts(client, row.id);
    if (hasDependents(counts)) {
      skipped.push({ id: row.id, hostname: row.hostname, reason: 'has_dependent_history', dependent_counts: counts });
    } else {
      removable.push(row);
    }
  }

  if (APPLY && removable.length) {
    await client.query('BEGIN');
    try {
      for (const row of removable) {
        await client.query(
          `UPDATE devices
           SET intune_device_id = NULL,
               serial_normalized = NULL
           WHERE id = $1`,
          [row.id]
        );
      }

      if (intuneSource) {
        await client.query(
          `UPDATE devices
           SET intune_device_id = $2,
               intune_last_sync_at = COALESCE($3, intune_last_sync_at),
               intune_synced_at = COALESCE($4, intune_synced_at),
               intune_enrolled_at = COALESCE($5, intune_enrolled_at),
               compliance_state = COALESCE($6, compliance_state),
               user_principal_name = COALESCE($7, user_principal_name),
               azure_ad_device_id = COALESCE($8, azure_ad_device_id),
               device_category = COALESCE($9, device_category),
               free_storage_bytes = COALESCE($10, free_storage_bytes),
               total_storage_bytes = COALESCE($11, total_storage_bytes),
               manufacturer = COALESCE($12, manufacturer),
               model = COALESCE($13, model),
               os = COALESCE($14, os),
               os_version = COALESCE($15, os_version)
           WHERE id = $1`,
          [
            canonical.id,
            intuneSource.intune_device_id,
            intuneSource.intune_last_sync_at,
            intuneSource.intune_synced_at,
            intuneSource.intune_enrolled_at,
            intuneSource.compliance_state,
            intuneSource.user_principal_name,
            intuneSource.azure_ad_device_id,
            intuneSource.device_category,
            intuneSource.free_storage_bytes,
            intuneSource.total_storage_bytes,
            intuneSource.manufacturer,
            intuneSource.model,
            intuneSource.os,
            intuneSource.os_version,
          ]
        );
      }

      for (const row of removable) {
        await client.query('DELETE FROM devices WHERE id = $1', [row.id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  return {
    serial_norm: group.serial_norm,
    canonical_device_id: canonical.id,
    intune_source_device_id: intuneSource?.id || null,
    removable_device_ids: removable.map(row => row.id),
    skipped,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    const groups = await duplicateGroups(client);
    const results = [];
    for (const group of groups) {
      results.push(await mergeGroup(client, group));
    }

    console.log(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry_run',
      duplicate_group_count: groups.length,
      removable_device_count: results.reduce((sum, item) => sum + item.removable_device_ids.length, 0),
      results,
    }, null, 2));
  } finally {
    client.release();
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
