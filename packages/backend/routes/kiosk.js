/**
 * Intake Kiosk router — the scan-to-register flow behind the printed QR
 * stickers (asset_number). Mounted WITHOUT the global auth middleware:
 *
 *   GET  /api/kiosk/resolve/:token   (public)  validate a QR token, show asset #
 *   POST /api/kiosk/auth             (public)  PIN -> short-lived operator token
 *   POST /api/kiosk/register         (operator) bind SN to the tag (+optional assign)
 *   POST /api/kiosk/mark-broken      (operator) send a registered device to repair
 *   POST /api/kiosk/assign           (operator) hand a registered device to a user
 *
 * Operator identity comes from a per-intern PIN (intake_operators.pin_hash) and
 * is written to device_lifecycle_logs.operator_email for a full audit trail.
 */
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const KIOSK_ROLE = 'intake_operator';

// Mirror routes/auth.js signing config, with a shorter (single-shift) lifetime.
function signKioskToken(operator) {
  const payload = {
    role: KIOSK_ROLE,
    op_id: operator.id,
    operator_name: operator.name,
    operator_email: operator.email || `intake:${operator.name}`,
  };
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PRIVATE_KEY.startsWith('-----BEGIN')) {
    return jwt.sign(payload, process.env.JWT_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '6h' });
  }
  return jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret-change-me', { algorithm: 'HS256', expiresIn: '6h' });
}

// Guard: require a valid kiosk operator token. Attaches req.operator.
function requireKioskOperator(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Kiosk session required — enter your PIN.' });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== KIOSK_ROLE) {
      return res.status(403).json({ error: 'Not an intake operator session.' });
    }
    req.operator = {
      id: decoded.op_id,
      name: decoded.operator_name,
      email: decoded.operator_email,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Kiosk session expired — enter your PIN again.' });
  }
}

// Shared: load the tag + linked device summary for a QR token.
async function loadAssetByToken(client, token) {
  const { rows } = await client.query(`
    SELECT
      at.asset_number,
      at.qr_token,
      at.device_id,
      at.bound_at,
      d.windows_sn,
      d.hostname,
      d.model,
      d.manufacturer,
      d.os,
      d.hardware_status,
      d.profile_number,
      da.assignee_email,
      da.assignee_type
    FROM asset_tags at
    LEFT JOIN devices d ON d.id = at.device_id
    LEFT JOIN device_assignments da ON da.device_id = d.id AND da.status = 'active'
    WHERE at.qr_token = $1
  `, [token]);
  return rows[0] || null;
}

function toAssetView(row) {
  if (!row) return null;
  return {
    asset_number: row.asset_number,
    registered: row.device_id != null,
    device: row.device_id == null ? null : {
      id: row.device_id,
      serial_number: row.windows_sn,
      hostname: row.hostname,
      model: row.model,
      manufacturer: row.manufacturer,
      os: row.os,
      hardware_status: row.hardware_status,
      profile_number: row.profile_number,
      assignee_email: row.assignee_email,
      assignee_type: row.assignee_type,
    },
  };
}

// Generate the next LAP-XXX profile number (collision-safe: MAX + 1).
async function nextProfileNumber(client) {
  const { rows } = await client.query(`
    SELECT COALESCE(MAX((SUBSTRING(profile_number FROM 'LAP-([0-9]+)'))::int), 0) AS max_n
    FROM devices
    WHERE profile_number ~ '^LAP-[0-9]+$'
  `);
  return `LAP-${String((rows[0].max_n || 0) + 1).padStart(3, '0')}`;
}

// If the caller replays a client_transaction_uuid we already applied, short-circuit.
async function findReplay(client, uuid) {
  if (!uuid) return null;
  const { rows } = await client.query(
    'SELECT id FROM device_lifecycle_logs WHERE client_transaction_uuid = $1 LIMIT 1',
    [uuid]
  );
  return rows.length ? rows[0] : null;
}

/**
 * GET /api/kiosk/resolve/:token  (public)
 * Validate a scanned QR token. Returns just the asset number + registered flag
 * so an invalid sticker fails before the operator wastes a PIN entry. Device
 * details are only returned after authentication.
 */
router.get('/resolve/:token', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT asset_number, device_id FROM asset_tags WHERE qr_token = $1',
      [req.params.token]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Unknown QR tag — not part of this fleet.' });
    }
    res.json({ asset_number: rows[0].asset_number, registered: rows[0].device_id != null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/kiosk/auth  (public)
 * Body: { token, pin }
 * The PIN alone identifies the operator (per-intern). Returns a kiosk token and
 * the full asset state for that QR tag so the UI can branch in one round-trip.
 */
router.post('/auth', async (req, res, next) => {
  const { token, pin } = req.body || {};
  if (!token || !pin) return res.status(400).json({ error: 'token and pin are required' });

  const client = await pool.connect();
  try {
    // Confirm the tag exists first (avoids leaking whether a PIN was valid for a bad tag).
    const asset = await loadAssetByToken(client, token);
    if (!asset) return res.status(404).json({ error: 'Unknown QR tag — not part of this fleet.' });

    // Match the PIN against active operators (small set; linear compare is fine).
    const { rows: operators } = await client.query(
      'SELECT id, name, email, pin_hash FROM intake_operators WHERE active = TRUE'
    );
    let matched = null;
    for (const op of operators) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(String(pin), op.pin_hash)) { matched = op; break; }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid PIN.' });

    await client.query('UPDATE intake_operators SET last_used_at = NOW() WHERE id = $1', [matched.id]);

    const kioskToken = signKioskToken(matched);
    res.json({
      kiosk_token: kioskToken,
      operator: { id: matched.id, name: matched.name, email: matched.email },
      asset: toAssetView(asset),
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/kiosk/register  (operator)
 * Body: { token, serial, mark_broken?, symptoms?, notes?, assignee_email?, assignee_type?, client_transaction_uuid? }
 * Binds a BIOS serial to the scanned asset tag (permanent 1:1), sets the device
 * Working (or intake_broken), and optionally assigns it to a user in one step.
 */
router.post('/register', requireKioskOperator, async (req, res, next) => {
  const {
    token, serial, mark_broken = false, symptoms = [], notes = null,
    assignee_email = null, assignee_type = 'student', client_transaction_uuid = null,
  } = req.body || {};

  if (!token || !serial || !String(serial).trim()) {
    return res.status(400).json({ error: 'token and serial are required' });
  }
  const sn = String(serial).trim();
  const operatorEmail = req.operator.email;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (await findReplay(client, client_transaction_uuid)) {
      await client.query('COMMIT');
      const asset = await loadAssetByToken(client, token);
      return res.json({ success: true, replayed: true, asset: toAssetView(asset) });
    }

    // Lock the tag row so two operators can't bind the same sticker concurrently.
    const { rows: tagRows } = await client.query(
      'SELECT asset_number, device_id FROM asset_tags WHERE qr_token = $1 FOR UPDATE',
      [token]
    );
    if (tagRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Unknown QR tag.' });
    }
    if (tagRows[0].device_id != null) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This asset is already registered. Scan it to mark broken or reassign.' });
    }
    const assetNumber = tagRows[0].asset_number;

    // Find or create the device by BIOS serial.
    const { rows: devRows } = await client.query(
      'SELECT id, profile_number, hardware_status FROM devices WHERE windows_sn = $1',
      [sn]
    );
    let deviceId, profileNumber, prevStatus;
    if (devRows.length > 0) {
      deviceId = devRows[0].id;
      profileNumber = devRows[0].profile_number;
      prevStatus = devRows[0].hardware_status;
      // Enforce permanent 1:1 — this serial must not already wear another tag.
      const { rows: otherTag } = await client.query(
        'SELECT asset_number FROM asset_tags WHERE device_id = $1',
        [deviceId]
      );
      if (otherTag.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Serial ${sn} is already bound to asset #${otherTag[0].asset_number}.` });
      }
    } else {
      profileNumber = await nextProfileNumber(client);
      prevStatus = null;
      const { rows: ins } = await client.query(
        `INSERT INTO devices (windows_sn, profile_number, hardware_status)
         VALUES ($1, $2, 'working_in_use') RETURNING id`,
        [sn, profileNumber]
      );
      deviceId = ins[0].id;
    }
    if (!profileNumber) {
      profileNumber = await nextProfileNumber(client);
      await client.query('UPDATE devices SET profile_number = $1 WHERE id = $2', [profileNumber, deviceId]);
    }

    const newStatus = mark_broken ? 'intake_broken' : 'working_in_use';
    await client.query('UPDATE devices SET hardware_status = $1 WHERE id = $2', [newStatus, deviceId]);

    // Bind the tag to the device (the permanent link).
    await client.query(
      'UPDATE asset_tags SET device_id = $1, bound_at = NOW(), bound_by = $2 WHERE qr_token = $3',
      [deviceId, operatorEmail, token]
    );

    // Optional immediate assignment (skipped when marking broken).
    let assigned = null;
    if (!mark_broken && assignee_email && String(assignee_email).trim()) {
      await client.query(
        `UPDATE device_assignments SET status = 'returned', unassigned_at = NOW()
         WHERE device_id = $1 AND status = 'active'`,
        [deviceId]
      );
      await client.query(
        `INSERT INTO device_assignments (device_id, assignee_email, assignee_type, status)
         VALUES ($1, $2, $3, 'active')`,
        [deviceId, String(assignee_email).trim(), assignee_type]
      );
      assigned = String(assignee_email).trim();
    }

    await client.query(
      `INSERT INTO device_lifecycle_logs
         (device_id, operator_email, action_type, previous_state, new_state, symptom_tags, repair_details, client_transaction_uuid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        deviceId, operatorEmail,
        mark_broken ? 'REGISTER_BROKEN' : 'REGISTER',
        JSON.stringify({ hardware_status: prevStatus, asset_number: null }),
        JSON.stringify({ hardware_status: newStatus, asset_number: assetNumber, serial: sn, assignee: assigned }),
        mark_broken ? (symptoms || []) : null,
        notes,
        client_transaction_uuid,
      ]
    );

    await client.query('COMMIT');
    const asset = await loadAssetByToken(pool, token);
    res.json({ success: true, asset_number: assetNumber, profile_number: profileNumber, device_id: deviceId, asset: toAssetView(asset) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/kiosk/mark-broken  (operator)
 * Body: { token, symptoms?, notes?, client_transaction_uuid? }
 * Sends an already-registered device to the repair queue and closes its active
 * assignment. Repair completion is handled in the dashboard, not here.
 */
router.post('/mark-broken', requireKioskOperator, async (req, res, next) => {
  const { token, symptoms = [], notes = null, client_transaction_uuid = null } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  const operatorEmail = req.operator.email;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (await findReplay(client, client_transaction_uuid)) {
      await client.query('COMMIT');
      const asset = await loadAssetByToken(client, token);
      return res.json({ success: true, replayed: true, asset: toAssetView(asset) });
    }

    const { rows: tagRows } = await client.query(
      'SELECT device_id FROM asset_tags WHERE qr_token = $1 FOR UPDATE',
      [token]
    );
    if (tagRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Unknown QR tag.' }); }
    const deviceId = tagRows[0].device_id;
    if (deviceId == null) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Asset not registered yet — register it first.' }); }

    const { rows: devRows } = await client.query('SELECT hardware_status FROM devices WHERE id = $1', [deviceId]);
    const prevStatus = devRows[0] ? devRows[0].hardware_status : null;

    await client.query('UPDATE devices SET hardware_status = $1 WHERE id = $2', ['intake_broken', deviceId]);
    await client.query(
      `UPDATE device_assignments SET status = 'returned', unassigned_at = NOW(), unassign_reason = 'broken'
       WHERE device_id = $1 AND status = 'active'`,
      [deviceId]
    );
    await client.query(
      `INSERT INTO device_lifecycle_logs
         (device_id, operator_email, action_type, previous_state, new_state, symptom_tags, repair_details, client_transaction_uuid)
       VALUES ($1, $2, 'INTAKE_BROKEN', $3, $4, $5, $6, $7)`,
      [
        deviceId, operatorEmail,
        JSON.stringify({ hardware_status: prevStatus }),
        JSON.stringify({ hardware_status: 'intake_broken' }),
        symptoms || [], notes, client_transaction_uuid,
      ]
    );

    await client.query('COMMIT');
    const asset = await loadAssetByToken(pool, token);
    res.json({ success: true, asset: toAssetView(asset) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/kiosk/assign  (operator)
 * Body: { token, assignee_email, assignee_type?, notes?, client_transaction_uuid? }
 * Hands a registered device to a (new) user — closes the prior custody row and
 * opens a fresh one. Sets the device Working if it was broken/ready.
 */
router.post('/assign', requireKioskOperator, async (req, res, next) => {
  const { token, assignee_email, assignee_type = 'student', notes = null, client_transaction_uuid = null } = req.body || {};
  if (!token || !assignee_email || !String(assignee_email).trim()) {
    return res.status(400).json({ error: 'token and assignee_email are required' });
  }
  const email = String(assignee_email).trim();
  const operatorEmail = req.operator.email;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (await findReplay(client, client_transaction_uuid)) {
      await client.query('COMMIT');
      const asset = await loadAssetByToken(client, token);
      return res.json({ success: true, replayed: true, asset: toAssetView(asset) });
    }

    const { rows: tagRows } = await client.query(
      'SELECT device_id FROM asset_tags WHERE qr_token = $1 FOR UPDATE',
      [token]
    );
    if (tagRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Unknown QR tag.' }); }
    const deviceId = tagRows[0].device_id;
    if (deviceId == null) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Asset not registered yet — register it first.' }); }

    const { rows: devRows } = await client.query('SELECT hardware_status FROM devices WHERE id = $1', [deviceId]);
    const prevStatus = devRows[0] ? devRows[0].hardware_status : null;

    await client.query('UPDATE devices SET hardware_status = $1 WHERE id = $2', ['working_in_use', deviceId]);
    await client.query(
      `UPDATE device_assignments SET status = 'transferred', unassigned_at = NOW(), unassign_reason = 'role_change'
       WHERE device_id = $1 AND status = 'active'`,
      [deviceId]
    );
    await client.query(
      `INSERT INTO device_assignments (device_id, assignee_email, assignee_type, status)
       VALUES ($1, $2, $3, 'active')`,
      [deviceId, email, assignee_type]
    );
    await client.query(
      `INSERT INTO device_lifecycle_logs
         (device_id, operator_email, action_type, previous_state, new_state, repair_details, client_transaction_uuid)
       VALUES ($1, $2, 'ASSIGN', $3, $4, $5, $6)`,
      [
        deviceId, operatorEmail,
        JSON.stringify({ hardware_status: prevStatus }),
        JSON.stringify({ hardware_status: 'working_in_use', assignee: email }),
        notes, client_transaction_uuid,
      ]
    );

    await client.query('COMMIT');
    const asset = await loadAssetByToken(pool, token);
    res.json({ success: true, asset: toAssetView(asset) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── Admin: Operator management (requires dashboard JWT, not kiosk PIN) ─────────
// These are deliberately separate from the PIN-auth flow so only an admin
// can create / deactivate intern accounts.
const { authMiddleware } = require('../middleware/auth');

/**
 * GET /api/kiosk/operators  (admin)
 * List all intake operators.
 */
router.get('/operators', authMiddleware, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, active, created_at, last_used_at
       FROM intake_operators ORDER BY name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * POST /api/kiosk/operators  (admin)
 * Body: { name, email?, pin }
 * Creates a new intake operator. The PIN is bcrypt-hashed; the plaintext
 * is never stored.
 */
router.post('/operators', authMiddleware, async (req, res, next) => {
  const { name, email = null, pin } = req.body || {};
  if (!name || !pin || String(pin).trim().length < 4) {
    return res.status(400).json({ error: 'name and pin (≥4 chars) are required.' });
  }
  try {
    const pin_hash = await bcrypt.hash(String(pin), 10);
    const { rows } = await pool.query(
      `INSERT INTO intake_operators (name, email, pin_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, active, created_at`,
      [String(name).trim(), email ? String(email).trim() : null, pin_hash]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An operator with that email already exists.' });
    }
    next(err);
  }
});

/**
 * PATCH /api/kiosk/operators/:id  (admin)
 * Body: { active?, pin? }
 * Deactivate / reactivate an operator, or reset their PIN.
 */
router.patch('/operators/:id', authMiddleware, async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid operator id.' });

  const updates = [];
  const values  = [];

  if (typeof req.body.active === 'boolean') {
    values.push(req.body.active);
    updates.push(`active = $${values.length}`);
  }
  if (req.body.pin) {
    if (String(req.body.pin).trim().length < 4) {
      return res.status(400).json({ error: 'PIN must be at least 4 characters.' });
    }
    const pin_hash = await bcrypt.hash(String(req.body.pin), 10);
    values.push(pin_hash);
    updates.push(`pin_hash = $${values.length}`);
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update. Supply active or pin.' });
  }
  values.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE intake_operators SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, email, active, created_at, last_used_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Operator not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * GET /api/kiosk/tag-stats  (admin)
 * Summary counts for the asset tag pool — useful for the dashboard header.
 */
router.get('/tag-stats', authMiddleware, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                      AS total,
        COUNT(device_id)                              AS bound,
        COUNT(*) - COUNT(device_id)                  AS unbound,
        COUNT(CASE WHEN d.hardware_status = 'working_in_use'    THEN 1 END) AS working,
        COUNT(CASE WHEN d.hardware_status = 'intake_broken'     THEN 1 END) AS broken,
        COUNT(CASE WHEN d.hardware_status = 'in_repair'         THEN 1 END) AS in_repair,
        COUNT(CASE WHEN d.hardware_status = 'ready_for_reissue' THEN 1 END) AS ready,
        COUNT(CASE WHEN d.hardware_status = 'decommissioned'    THEN 1 END) AS decommissioned
      FROM asset_tags at
      LEFT JOIN devices d ON d.id = at.device_id
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * GET /api/kiosk/asset/:token  (operator)
 * Full asset + device state for an authenticated operator. Lets the scan page
 * re-hydrate after a reload without re-entering the PIN.
 */
router.get('/asset/:token', requireKioskOperator, async (req, res, next) => {
  try {
    const asset = await loadAssetByToken(pool, req.params.token);
    if (!asset) return res.status(404).json({ error: 'Unknown QR tag.' });
    res.json({ asset: toAssetView(asset), operator: req.operator });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/kiosk/roster?q=  (operator)
 * Type-ahead over the Circles student roster for assignment. Staff / unknown
 * users are handled by free-text email entry on the client (roster + fallback).
 */
router.get('/roster', requireKioskOperator, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const { rows } = await pool.query(
      `SELECT full_name, email, site_id
       FROM students
       WHERE email IS NOT NULL AND (full_name ILIKE $1 OR email ILIKE $1)
       ORDER BY full_name ASC
       LIMIT 8`,
      [`%${q}%`]
    );
    res.json(rows.map(r => ({ name: r.full_name, email: r.email, site_id: r.site_id })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

