-- Migration 010: OSINT Intelligence Schema (v4.1)
-- Adds Space Weather and Satellite TLE storage, plus GPS coords on sites.

-- 1. Space weather — stores NOAA planetary K-index readings every 3 hours
CREATE TABLE IF NOT EXISTS space_weather (
    id              SERIAL PRIMARY KEY,
    recorded_at     TIMESTAMPTZ NOT NULL,
    k_index         INT NOT NULL,
    solar_flux_10cm FLOAT,
    condition_label TEXT, -- e.g. 'G1 (Minor)', 'G5 (Extreme)'
    UNIQUE(recorded_at)
);

-- 2. Satellite TLE set — one row per Starlink bird, updated daily from CelesTrak
CREATE TABLE IF NOT EXISTS satellite_tles (
    id             SERIAL PRIMARY KEY,
    satellite_name TEXT NOT NULL,
    line1          TEXT NOT NULL,
    line2          TEXT NOT NULL,
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(satellite_name)
);

-- 3. Add GPS coordinates to sites so orbital coverage can be computed per site
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lat FLOAT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lng FLOAT;

-- Index for temporal correlation during signal diagnosis
CREATE INDEX IF NOT EXISTS idx_sw_time ON space_weather(recorded_at);
