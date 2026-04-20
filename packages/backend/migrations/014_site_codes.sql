-- Migration 014: Add readable site codes and ensure numeric IDs are stable
-- Format: RW-NNN-CODE  (RW = Rwanda, NNN = sequence, CODE = abbreviation)
-- Also adds site_type column: 'school' | 'office'

ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_code TEXT UNIQUE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_type TEXT DEFAULT 'school';

-- ── School sites ──────────────────────────────────────────────────────────────
UPDATE sites SET site_code = 'RW-001-ASYV',  site_type = 'school' WHERE name = 'ASYV';
UPDATE sites SET site_code = 'RW-002-CIC',   site_type = 'school' WHERE name = 'CIC Muramba';
UPDATE sites SET site_code = 'RW-003-CLA',   site_type = 'school' WHERE name = 'Cornerstone Leadership Academy';
UPDATE sites SET site_code = 'RW-004-ESG',   site_type = 'school' WHERE name = 'ES Gisenyi';
UPDATE sites SET site_code = 'RW-005-ENDP',  site_type = 'school' WHERE name = 'ENDP';
UPDATE sites SET site_code = 'RW-006-ESGK',  site_type = 'school' WHERE name = 'ES Gikonko';
UPDATE sites SET site_code = 'RW-007-ESJ',   site_type = 'school' WHERE name = 'ES Juru';
UPDATE sites SET site_code = 'RW-008-ESK',   site_type = 'school' WHERE name = 'ES Kirambo';
UPDATE sites SET site_code = 'RW-009-ESMG',  site_type = 'school' WHERE name = 'ES Mubuga - Gishyita';
UPDATE sites SET site_code = 'RW-010-ESR',   site_type = 'school' WHERE name = 'ES Ruhango';
UPDATE sites SET site_code = 'RW-011-ESRU',  site_type = 'school' WHERE name = 'ES Rusumo';
UPDATE sites SET site_code = 'RW-012-ESMK',  site_type = 'school' WHERE name = 'ES Sancta Maria Karambo';
UPDATE sites SET site_code = 'RW-013-FWG',   site_type = 'school' WHERE name = 'Fawe Gahini';
UPDATE sites SET site_code = 'RW-014-GSM',   site_type = 'school' WHERE name = 'GS Muhura';
UPDATE sites SET site_code = 'RW-015-GSGH',  site_type = 'school' WHERE name = 'GS Gihara';
UPDATE sites SET site_code = 'RW-016-GSGW',  site_type = 'school' WHERE name = 'GS Gihundwe';
UPDATE sites SET site_code = 'RW-017-GSGI',  site_type = 'school' WHERE name = 'GS Gishyita';
UPDATE sites SET site_code = 'RW-018-GSK',   site_type = 'school' WHERE name = 'GS Kinigi';
UPDATE sites SET site_code = 'RW-019-GSMA',  site_type = 'school' WHERE name = 'GS Maranyundo';
UPDATE sites SET site_code = 'RW-020-GSMB',  site_type = 'school' WHERE name = 'GS Mburabuturo';
UPDATE sites SET site_code = 'RW-021-GSMII', site_type = 'school' WHERE name = 'GS Mubuga II'  AND starlink_sn = '2DUNI00000336506';
UPDATE sites SET site_code = 'RW-022-ESMII', site_type = 'school' WHERE name = 'ES Mubuga II'  AND starlink_sn = 'M1HT022110332VMX';
UPDATE sites SET site_code = 'RW-023-GSNY',  site_type = 'school' WHERE name = 'GS Nyagasambu';
UPDATE sites SET site_code = 'RW-024-GSNG',  site_type = 'school' WHERE name = 'GS Nyange';
UPDATE sites SET site_code = 'RW-025-GSRF',  site_type = 'school' WHERE name = 'GS Rambura Filles';
UPDATE sites SET site_code = 'RW-026-GSRI',  site_type = 'school' WHERE name = 'GS Remera Indangamirwa';
UPDATE sites SET site_code = 'RW-027-GSRP',  site_type = 'school' WHERE name = 'GS Remera Protestant';
UPDATE sites SET site_code = 'RW-028-SPM',   site_type = 'school' WHERE name = 'St Paul Muko';
UPDATE sites SET site_code = 'RW-029-GSSM',  site_type = 'school' WHERE name = 'GS St Mathieu - Busasamana';
UPDATE sites SET site_code = 'RW-030-INY',   site_type = 'school' WHERE name = 'Inyange Girls';
UPDATE sites SET site_code = 'RW-031-LDZ',   site_type = 'school' WHERE name = 'Lycee De Zaza';
UPDATE sites SET site_code = 'RW-032-LNDC',  site_type = 'school' WHERE name = 'LNDC';
UPDATE sites SET site_code = 'RW-033-GSNC',  site_type = 'school' WHERE name = 'GS Notre Dame bon Conseil';
UPDATE sites SET site_code = 'RW-034-LSJ',   site_type = 'school' WHERE name = 'Lycee de St Jerome Janja';
UPDATE sites SET site_code = 'RW-035-MGS',   site_type = 'school' WHERE name = 'Maranyundo Girls School';
UPDATE sites SET site_code = 'RW-036-PSL',   site_type = 'school' WHERE name = 'Petit Seminaire St Leon';
UPDATE sites SET site_code = 'RW-037-PSJP',  site_type = 'school' WHERE name = 'PS St Jean Paul II';
UPDATE sites SET site_code = 'RW-038-SOR',   site_type = 'school' WHERE name = 'SOPEM Rukomo';
UPDATE sites SET site_code = 'RW-039-RWL',   site_type = 'school' WHERE name = 'Rwamagana Leaders';
UPDATE sites SET site_code = 'RW-040-SJN',   site_type = 'school' WHERE name = 'St Joseph Nyamasheke';

-- ── Head Office ───────────────────────────────────────────────────────────────
UPDATE sites SET site_code = 'RW-041-B2R',   site_type = 'office' WHERE name = 'Bridge2Rwanda - Headoffice';

-- ── Count check ───────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM sites WHERE site_code IS NOT NULL;
  RAISE NOTICE 'Sites with site_code: %', cnt;
END $$;
