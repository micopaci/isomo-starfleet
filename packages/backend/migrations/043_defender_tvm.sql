-- Migration 043: Microsoft Defender for Endpoint TVM (Threat & Vulnerability Management)
-- Ingests every CVE Defender reports for every product on every managed machine,
-- correlates Defender machines back to `devices`, and caches AI mitigation guidance.

-- Catalog of vulnerabilities (one row per CVE / TVM-* zero-day id).
CREATE TABLE IF NOT EXISTS vulnerabilities (
  id                TEXT PRIMARY KEY,                  -- 'CVE-2026-13774' or 'TVM-2026-0001'
  name              TEXT,
  description       TEXT,
  severity          TEXT NOT NULL DEFAULT 'Medium',    -- Defender values: Critical/High/Medium/Low
  cvss_v3           NUMERIC(3,1),
  is_zero_day       BOOLEAN NOT NULL DEFAULT FALSE,
  public_exploit    BOOLEAN NOT NULL DEFAULT FALSE,
  published_at      TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  -- AI mitigation guidance cache (populated by services/aiMitigation.js).
  ai_guidance       JSONB,
  ai_guidance_model TEXT,
  ai_guidance_at    TIMESTAMPTZ,
  first_synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-device exposure. One row per (device, vulnerability). The UNIQUE excludes
-- product/version deliberately so a single ON CONFLICT upsert can't explode into
-- many rows when Defender reports the same CVE against multiple stale versions on
-- one machine; the sync keeps the highest-version row's product fields.
CREATE TABLE IF NOT EXISTS device_vulnerabilities (
  id               BIGSERIAL PRIMARY KEY,
  device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id) ON DELETE CASCADE,
  product_name     TEXT,
  product_vendor   TEXT,
  product_version  TEXT,
  fixing_kb_id     TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  UNIQUE (device_id, vulnerability_id)
);

CREATE INDEX IF NOT EXISTS idx_device_vulns_vuln_status
  ON device_vulnerabilities(vulnerability_id, status);
CREATE INDEX IF NOT EXISTS idx_device_vulns_device_status
  ON device_vulnerabilities(device_id, status);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity
  ON vulnerabilities(severity);

-- Correlate `devices` rows to their Defender machine so read queries can avoid
-- re-correlating and the sync can resolve a stable machine id.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS defender_machine_id TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS defender_synced_at  TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_defender_machine_id
  ON devices(defender_machine_id) WHERE defender_machine_id IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_devices_defender_machine_id;
-- ALTER TABLE devices DROP COLUMN IF EXISTS defender_synced_at;
-- ALTER TABLE devices DROP COLUMN IF EXISTS defender_machine_id;
-- DROP INDEX IF EXISTS idx_vulnerabilities_severity;
-- DROP INDEX IF EXISTS idx_device_vulns_device_status;
-- DROP INDEX IF EXISTS idx_device_vulns_vuln_status;
-- DROP TABLE IF EXISTS device_vulnerabilities;
-- DROP TABLE IF EXISTS vulnerabilities;
