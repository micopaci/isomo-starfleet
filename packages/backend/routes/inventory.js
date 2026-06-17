const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/inventory
// Fetch master ledger of devices, their active assignments, and last known operator
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        d.id,
        d.windows_sn AS serial_number,
        d.profile_number,
        d.hardware_status,
        d.model,
        d.os,
        d.os_version,
        d.last_seen AS last_seen_at,
        da.assignee_email,
        da.assignee_type,
        dl.operator_email as last_operator,
        dl.action_type as last_action,
        dl.recorded_at as last_action_at
      FROM devices d
      LEFT JOIN device_assignments da ON d.id = da.device_id AND da.status = 'active'
      LEFT JOIN LATERAL (
        SELECT operator_email, action_type, recorded_at 
        FROM device_lifecycle_logs
        WHERE device_id = d.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) dl ON true
      WHERE d.hardware_status IS NOT NULL
      ORDER BY d.last_seen DESC NULLS LAST
    `);

    const formatted = rows.map(r => ({
      id: r.id,
      serial_number: r.serial_number,
      profile_number: r.profile_number,
      hardware_status: r.hardware_status,
      model: r.model,
      os_info: r.os ? { release: `${r.os} ${r.os_version || ''}`.trim() } : null,
      last_seen_at: r.last_seen_at,
      assignee_email: r.assignee_email,
      assignee_type: r.assignee_type,
      last_operator: r.last_operator,
      last_action: r.last_action,
      last_action_at: r.last_action_at
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/intake
// Drop-off a broken laptop
router.post('/intake', async (req, res, next) => {
  const { serial, symptoms, notes, operator_email } = req.body;
  if (!serial || !operator_email) return res.status(400).json({ error: 'Missing serial or operator_email' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find the device
    const { rows: devRows } = await client.query('SELECT id, profile_number, hardware_status FROM devices WHERE windows_sn = $1', [serial]);
    if (devRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Device not found' });
    }
    const device = devRows[0];

    // Generate profile_number if missing
    let profileNumber = device.profile_number;
    if (!profileNumber) {
      const { rows: pRows } = await client.query('SELECT COUNT(*) as count FROM devices WHERE profile_number IS NOT NULL');
      profileNumber = `LAP-${String(parseInt(pRows[0].count) + 1).padStart(3, '0')}`;
      await client.query('UPDATE devices SET profile_number = $1 WHERE id = $2', [profileNumber, device.id]);
    }

    const prevState = { hardware_status: device.hardware_status, profile_number: profileNumber };

    // Update hardware status
    await client.query('UPDATE devices SET hardware_status = $1 WHERE id = $2', ['intake_broken', device.id]);

    // Close any active assignments
    await client.query(`
      UPDATE device_assignments 
      SET status = 'returned', unassigned_at = NOW(), unassign_reason = 'broken'
      WHERE device_id = $1 AND status = 'active'
    `, [device.id]);

    // Log the event
    await client.query(`
      INSERT INTO device_lifecycle_logs (device_id, operator_email, action_type, previous_state, new_state, symptom_tags, repair_details)
      VALUES ($1, $2, 'INTAKE_BROKEN', $3, $4, $5, $6)
    `, [
      device.id, operator_email, 
      JSON.stringify(prevState), 
      JSON.stringify({ hardware_status: 'intake_broken' }), 
      symptoms || [], 
      notes
    ]);

    await client.query('COMMIT');
    res.json({ success: true, profile_number: profileNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/inventory/reconcile
// Resolve an inventory mismatch
router.post('/reconcile', async (req, res, next) => {
  const { profile, action, assignee_email, comment, operator_email } = req.body;
  if (!profile || !action || !operator_email) return res.status(400).json({ error: 'Missing required fields' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: devRows } = await client.query('SELECT id, hardware_status FROM devices WHERE profile_number = $1', [profile]);
    if (devRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Device not found' });
    }
    const device = devRows[0];
    const prevState = { hardware_status: device.hardware_status };

    if (action === 'reassign') {
      if (!assignee_email) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'assignee_email required for reassign' });
      }

      await client.query('UPDATE devices SET hardware_status = $1 WHERE id = $2', ['working_in_use', device.id]);
      
      // End previous assignments just in case
      await client.query(`UPDATE device_assignments SET status = 'returned', unassigned_at = NOW() WHERE device_id = $1 AND status = 'active'`, [device.id]);
      
      // Create new assignment
      await client.query(`
        INSERT INTO device_assignments (device_id, assignee_email, assignee_type, status)
        VALUES ($1, $2, 'student', 'active')
      `, [device.id, assignee_email]);

      // Log
      await client.query(`
        INSERT INTO device_lifecycle_logs (device_id, operator_email, action_type, previous_state, new_state)
        VALUES ($1, $2, 'VERIFICATION_MISMATCH_RESOLVED', $3, $4)
      `, [device.id, operator_email, JSON.stringify(prevState), JSON.stringify({ hardware_status: 'working_in_use' })]);

    } else if (action === 'comment') {
      await client.query(`
        INSERT INTO device_lifecycle_logs (device_id, operator_email, action_type, repair_details)
        VALUES ($1, $2, 'DIAGNOSTIC_COMMENT', $3)
      `, [device.id, operator_email, comment]);
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid action' });
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
