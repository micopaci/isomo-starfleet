-- Migration 024: OSINT Anomaly Events table
-- Structured event log for KP_THRESHOLD, TLE_DEVIATION, and CORRELATION anomalies.
-- Written by the osintCorrelator service (15-minute cycle).

CREATE TABLE IF NOT EXISTS osint_anomaly_events (
    id              BIGSERIAL PRIMARY KEY,
    site_id         VARCHAR(64) NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    anomaly_type    VARCHAR(64) NOT NULL CHECK (anomaly_type IN ('TLE_DEVIATION', 'KP_THRESHOLD', 'CORRELATION')),
    severity        SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
    kp_index        NUMERIC(4,2),
    tle_epoch_age_h NUMERIC(6,2),
    satellite_id    VARCHAR(32),
    raw_payload     JSONB,
    resolved        BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_osint_anomaly_site_time
    ON osint_anomaly_events (site_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_osint_anomaly_unresolved
    ON osint_anomaly_events (resolved)
    WHERE resolved = FALSE;

-- ROLLBACK: DROP TABLE IF EXISTS osint_anomaly_events;
