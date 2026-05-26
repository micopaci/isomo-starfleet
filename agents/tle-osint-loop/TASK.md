# Agent Task: TLE + Space Weather OSINT Loop
<!-- Claude Code task file. Run with: claude --task agents/tle-osint-loop/TASK.md -->

## Objective
Convert the existing on-demand OSINT engine (`osint/`) into an **autonomous scheduled loop**
that fuses Starlink TLE orbital data with NOAA Kp space weather indices,
correlates anomalies against site connectivity state in PostgreSQL,
and writes structured anomaly records for dashboard consumption.

---

## Scope

**In scope:**
- Extending/refactoring `osint/tle/` and `osint/weather/` modules
- New `osint/fusion/correlator.py` correlation engine
- PostgreSQL migration for `osint_anomaly_events` table
- Cron scheduling config (system crontab entry or `osint/scheduler.py` using APScheduler)
- Graceful degradation when dish gRPC endpoint or NOAA is unreachable

**Out of scope:**
- Dashboard UI changes (Electron / React Native)
- Alerting / notification delivery (that is a separate agent)
- Changes to `agent/` PowerShell scripts

---

## Step-by-Step Build Plan

### Step 1 — Audit existing OSINT modules

Read all files under `osint/`. Map:
- What TLE data is already being fetched and from where
- What space weather data exists
- What the current output format is (if any)
- Any hardcoded credentials → flag and replace with env vars

Do not modify anything in this step. Produce a written audit summary before proceeding.

### Step 2 — Define the PostgreSQL schema

Create migration: `db/migrations/YYYYMMDD_001_osint_anomaly_events.sql`

Required table: `osint_anomaly_events`

```sql
CREATE TABLE osint_anomaly_events (
    id              BIGSERIAL PRIMARY KEY,
    site_id         VARCHAR(64) NOT NULL,          -- Starlink site identifier
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    anomaly_type    VARCHAR(64) NOT NULL,           -- 'TLE_DEVIATION' | 'KP_THRESHOLD' | 'CORRELATION'
    severity        SMALLINT NOT NULL,              -- 1 (low) to 5 (critical)
    kp_index        NUMERIC(4,2),                  -- NOAA Kp value at time of event
    tle_epoch_age_h NUMERIC(6,2),                  -- Hours since TLE epoch (stale TLE = higher risk)
    satellite_id    VARCHAR(32),                   -- NORAD ID or Starlink sat name
    raw_payload     JSONB,                         -- Full data dump for debugging
    resolved        BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT
);

CREATE INDEX idx_osint_anomaly_site_time ON osint_anomaly_events (site_id, recorded_at DESC);
CREATE INDEX idx_osint_anomaly_unresolved ON osint_anomaly_events (resolved) WHERE resolved = FALSE;
```

Include rollback block:
```sql
-- ROLLBACK: DROP TABLE IF EXISTS osint_anomaly_events;
```

### Step 3 — TLE Fetch Module (`osint/tle/fetcher.py`)

Implement `fetch_starlink_tles() -> list[dict]`:
- Primary source: `https://celestrak.org/SOCRATES/query.php` or `https://celestrak.org/SATCAT/` for Starlink group TLEs
- Fallback: cached local file `osint/tle/cache/latest.tle` (write on every successful fetch)
- Parse TLE lines 1 and 2 using `sgp4` library
- Return list of dicts: `{norad_id, name, epoch_dt, tle_age_hours, line1, line2}`
- If fetch fails and cache is older than 48h, set `severity=4` and log `WARN`

### Step 4 — Space Weather Module (`osint/weather/kp_fetcher.py`)

Implement `fetch_kp_index() -> dict`:
- Source: `https://services.swpc.noaa.gov/json/planetary_k_index_1m.json`
- Return: `{kp_value: float, recorded_at: datetime, source: str}`
- Threshold mapping (store as constants in `osint/weather/thresholds.py`):
  ```
  KP < 3     → severity 1 (quiet)
  3 ≤ KP < 5 → severity 2 (unsettled)
  5 ≤ KP < 6 → severity 3 (minor storm)
  6 ≤ KP < 7 → severity 4 (moderate storm)
  KP ≥ 7     → severity 5 (severe — flag all sites)
  ```

### Step 5 — Correlation Engine (`osint/fusion/correlator.py`)

Implement `run_correlation_cycle(db_conn) -> list[AnomalyEvent]`:

Logic:
1. Fetch current Kp index
2. Fetch latest TLEs for Starlink satellites
3. For each active site in `sites` table:
   - Compute visible Starlink satellites using `skyfield` (elevation > 25°, site lat/lon from DB)
   - Check TLE epoch age for those satellites (stale TLE > 24h → flag)
   - If Kp ≥ 5 AND site has connectivity degradation in last 30 min → create `CORRELATION` event
   - If Kp ≥ 5 alone → create `KP_THRESHOLD` event
   - If TLE age > 48h → create `TLE_DEVIATION` event
4. Write all new events to `osint_anomaly_events` via parameterised query (no string formatting)
5. Return list of written events for logging

**Graceful degradation rules:**
- NOAA unreachable → skip Kp check, log `WARN`, do not write events, continue TLE check
- gRPC dish endpoint unreachable → skip site-level correlation, log `INFO`, do not treat as anomaly
- DB unreachable → log `FATAL`, exit loop iteration (do not accumulate in memory)

### Step 6 — Scheduler

Option A (preferred if system crontab is accessible):
Generate a crontab entry:
```
*/15 * * * * /usr/bin/python3 /path/to/starfleet/osint/run_cycle.py >> /var/log/starfleet/osint.log 2>&1
```

Option B (if crontab is not writable):
Implement `osint/scheduler.py` using `APScheduler` (BlockingScheduler, interval 15 min).

Check which is viable: run `crontab -l` first. Use Option A if exit code 0. Fall back to Option B.

`osint/run_cycle.py` — entry point:
```python
# Minimal entry point — does not contain business logic
from osint.fusion.correlator import run_correlation_cycle
from osint.db import get_connection
import logging, sys

logging.basicConfig(level=logging.INFO, format='{"timestamp":"%(asctime)s","level":"%(levelname)s","agent":"tle-osint-loop","event":"%(message)s"}')

if __name__ == "__main__":
    conn = get_connection()
    events = run_correlation_cycle(conn)
    logging.info(f"cycle_complete payload={{'events_written': {len(events)}}}")
    sys.exit(0)
```

### Step 7 — Dependency Check

Verify `osint/requirements.txt` includes:
```
sgp4>=2.22
skyfield>=1.48
psycopg2-binary>=2.9
apscheduler>=3.10   # Only if Option B
requests>=2.31
```

Add any missing entries. Do not pin to exact versions unless an existing pin is already present.

### Step 8 — Smoke Test

Before finalising, run:
```bash
python3 -c "from osint.tle.fetcher import fetch_starlink_tles; print(fetch_starlink_tles()[:2])"
python3 -c "from osint.weather.kp_fetcher import fetch_kp_index; print(fetch_kp_index())"
```

If either fails, fix before writing to DB.

---

## Output Checklist (confirm before closing task)

- [ ] Audit summary produced and reviewed
- [ ] Migration file created with rollback block
- [ ] `fetch_starlink_tles()` returns valid data with epoch age
- [ ] `fetch_kp_index()` returns valid Kp value
- [ ] Correlation engine writes at least one test record to DB (use `site_id='TEST'`)
- [ ] Scheduler confirmed running (crontab entry or APScheduler process)
- [ ] All env vars sourced from environment, zero hardcoded values
- [ ] `requirements.txt` updated
- [ ] Graceful degradation tested: run with `STARLINK_GRPC_HOST=0.0.0.0` and confirm no crash

---

## Known Constraints

- The local Starlink gRPC endpoint (`192.168.100.1:9200`) is only reachable when the dish is online. Design for this being unreachable ~10% of the time.
- Rwanda is approximately at latitude -2°, longitude 30°. Use this as the default bounding box for satellite visibility calculations until site-level lat/lon is confirmed in DB.
- TLE data from Celestrak is updated every few hours. A 15-minute polling interval will not always yield new TLEs — implement a content hash check to avoid redundant processing.
