-- Migration 013: Update GPS coordinates to full 7-decimal precision
-- Source: Tech - Circles School Coordinates (Google Sheets) — raw decimal values
-- Improves pin placement accuracy and eliminates clustering from rounding errors.

UPDATE sites SET lat = -2.0329309, lng = 30.3836233 WHERE name = 'ASYV';
UPDATE sites SET lat = -1.7637499, lng = 29.6165868 WHERE name = 'CIC Muramba';
UPDATE sites SET lat = -1.8985942, lng = 30.3132356 WHERE name = 'Cornerstone Leadership Academy';
UPDATE sites SET lat = -1.6996088, lng = 29.2623775 WHERE name = 'ES Gisenyi';
UPDATE sites SET lat = -2.5925370, lng = 29.7415385 WHERE name = 'ENDP';
UPDATE sites SET lat = -2.5872102, lng = 29.8237408 WHERE name = 'ES Gikonko';
UPDATE sites SET lat = -2.0995494, lng = 30.1882454 WHERE name = 'ES Juru';
UPDATE sites SET lat = -1.4970611, lng = 29.8347589 WHERE name = 'ES Kirambo';
UPDATE sites SET lat = -2.1329979, lng = 29.3133243 WHERE name = 'ES Mubuga - Gishyita';
UPDATE sites SET lat = -2.2236647, lng = 29.7941854 WHERE name = 'ES Ruhango';
UPDATE sites SET lat = -2.2749673, lng = 30.6681046 WHERE name = 'ES Rusumo';
UPDATE sites SET lat = -1.8386847, lng = 30.2456799 WHERE name = 'ES Sancta Maria Karambo';
UPDATE sites SET lat = -1.8602706, lng = 30.4987431 WHERE name = 'Fawe Gahini';
UPDATE sites SET lat = -1.7403194, lng = 30.2718630 WHERE name = 'GS Muhura';
UPDATE sites SET lat = -2.0355459, lng = 29.4231178 WHERE name = 'GS Gihara';
UPDATE sites SET lat = -2.4906152, lng = 28.9156994 WHERE name = 'GS Gihundwe';
UPDATE sites SET lat = -2.1561212, lng = 29.2953789 WHERE name = 'GS Gishyita';
UPDATE sites SET lat = -1.4437232, lng = 29.5752167 WHERE name = 'GS Kinigi';
UPDATE sites SET lat = -2.1511691, lng = 30.1028716 WHERE name = 'GS Maranyundo';
UPDATE sites SET lat = -1.9635695, lng = 30.0749112 WHERE name = 'GS Mburabuturo';
UPDATE sites SET lat = -2.3851946, lng = 29.7158495 WHERE name = 'GS Mubuga II'         AND starlink_sn = '2DUNI00000336506';
UPDATE sites SET lat = -2.3851925, lng = 29.7157687 WHERE name = 'ES Mubuga II'         AND starlink_sn = 'M1HT022110332VMX';
UPDATE sites SET lat = -1.8956861, lng = 30.2749903 WHERE name = 'GS Nyagasambu';
UPDATE sites SET lat = -2.1052734, lng = 30.3724247 WHERE name = 'GS Nyange';
UPDATE sites SET lat = -1.6786560, lng = 29.5202577 WHERE name = 'GS Rambura Filles';
UPDATE sites SET lat = -1.9413314, lng = 29.9076855 WHERE name = 'GS Remera Indangamirwa';
UPDATE sites SET lat = -1.9617521, lng = 30.1191928 WHERE name = 'GS Remera Protestant';
UPDATE sites SET lat = -2.6990812, lng = 29.0099631 WHERE name = 'St Paul Muko';
UPDATE sites SET lat = -1.5864705, lng = 29.3516717 WHERE name = 'GS St Mathieu - Busasamana';
UPDATE sites SET lat = -1.7653945, lng = 29.9289284 WHERE name = 'Inyange Girls';
UPDATE sites SET lat = -2.1537191, lng = 30.4339394 WHERE name = 'Lycee De Zaza';
UPDATE sites SET lat = -1.9524559, lng = 30.0592132 WHERE name = 'LNDC';
UPDATE sites SET lat = -1.5703995, lng = 30.0481958 WHERE name = 'GS Notre Dame bon Conseil';
UPDATE sites SET lat = -1.6793033, lng = 29.6775267 WHERE name = 'Lycee de St Jerome Janja';
UPDATE sites SET lat = -2.1523206, lng = 30.1011680 WHERE name = 'Maranyundo Girls School';
UPDATE sites SET lat = -2.0970485, lng = 29.7546324 WHERE name = 'Petit Seminaire St Leon';
UPDATE sites SET lat = -2.4707161, lng = 29.5891246 WHERE name = 'PS St Jean Paul II';
UPDATE sites SET lat = -1.3788442, lng = 30.2442777 WHERE name = 'SOPEM Rukomo';
UPDATE sites SET lat = -1.9402194, lng = 30.4322910 WHERE name = 'Rwamagana Leaders';
UPDATE sites SET lat = -2.3358650, lng = 29.0921411 WHERE name = 'St Joseph Nyamasheke';
UPDATE sites SET lat = -1.9524559, lng = 30.0592132 WHERE name = 'Bridge2Rwanda - Headoffice';

-- Count check
DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM sites WHERE lat IS NOT NULL AND lng IS NOT NULL;
  RAISE NOTICE 'Sites with GPS coordinates after precision update: %', cnt;
END $$;
