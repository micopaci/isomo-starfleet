-- Migration 034: Device Inventory & Assignments Ledger

-- 1. Extend the devices table for inventory tracking
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS profile_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS hardware_status TEXT NOT NULL DEFAULT 'working_in_use'
    CHECK (hardware_status IN ('working_in_use', 'intake_broken', 'in_repair', 'ready_for_reissue', 'decommissioned'));

CREATE INDEX IF NOT EXISTS idx_devices_profile_number ON devices(profile_number);
CREATE INDEX IF NOT EXISTS idx_devices_hardware_status ON devices(hardware_status);

-- 2. Create the assignments ledger table (tracks history of custody)
CREATE TABLE IF NOT EXISTS device_assignments (
  id             SERIAL PRIMARY KEY,
  device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  assignee_email TEXT NOT NULL, -- Serves as the primary key link to Student/Staff Azure AD email
  assignee_type  TEXT NOT NULL CHECK (assignee_type IN ('student', 'staff', 'pool')),
  site_id        INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at  TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'transferred')),
  unassign_reason TEXT CHECK (unassign_reason IN ('broken', 'graduated', 'left_org', 'upgraded', 'role_change'))
);

CREATE INDEX IF NOT EXISTS idx_device_assignments_device ON device_assignments(device_id);
CREATE INDEX IF NOT EXISTS idx_device_assignments_email ON device_assignments(assignee_email);
CREATE INDEX IF NOT EXISTS idx_device_assignments_status ON device_assignments(status) WHERE status = 'active';

-- 3. Create the device lifecycle logs table (technical repair audit trail)
CREATE TABLE IF NOT EXISTS device_lifecycle_logs (
  id                      SERIAL PRIMARY KEY,
  device_id               INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  operator_email          TEXT NOT NULL, -- User/intern who executed the transaction
  action_type             TEXT NOT NULL, -- REGISTER, BIND_LABEL, INTAKE_BROKEN, REPAIR_START, REPAIR_COMPLETE, ASSIGN, UNASSIGN, DECOMMISSION, VERIFICATION_MISMATCH
  previous_state          JSONB, -- Snapshot of device fields before change
  new_state               JSONB, -- Snapshot of device fields after change
  symptom_tags            TEXT[], -- e.g., {'ssd_fail', 'lockout', 'screen_crack'}
  repair_details          TEXT,   -- Free-form diagnostic notes
  client_transaction_uuid TEXT UNIQUE, -- Client-generated UUID for idempotency
  recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_lifecycle_logs_device ON device_lifecycle_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_device_lifecycle_logs_action ON device_lifecycle_logs(action_type);

-- ROLLBACK:
-- DROP TABLE IF EXISTS device_lifecycle_logs;
-- DROP TABLE IF EXISTS device_assignments;
-- ALTER TABLE devices DROP COLUMN IF EXISTS hardware_status;
-- ALTER TABLE devices DROP COLUMN IF EXISTS profile_number;
