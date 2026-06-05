-- Migration 027: Students roster
-- Circles Class of 2026 — one row per enrolled student, linked to their school's site.

CREATE TABLE IF NOT EXISTS students (
  id        SERIAL PRIMARY KEY,
  full_name TEXT        NOT NULL,
  email     TEXT UNIQUE NOT NULL,
  school    TEXT        NOT NULL,
  site_id   INT         REFERENCES sites(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_students_site_id ON students(site_id);
CREATE INDEX IF NOT EXISTS idx_students_school  ON students(school);

-- ROLLBACK:
-- DROP TABLE IF EXISTS students;
