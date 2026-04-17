-- Migration 012: GPS coordinates from Circles School Coordinates sheet
-- Source: Tech - Circles School Coordinates (Google Sheets)
-- All coordinates are verified decimal lat/lng from the official mastersheet.

UPDATE sites SET lat = -2.032931, lng = 30.383623 WHERE name = 'ASYV';
UPDATE sites SET lat = -1.763750, lng = 29.616587 WHERE name = 'CIC Muramba';
UPDATE sites SET lat = -1.898594, lng = 30.313236 WHERE name = 'Cornerstone Leadership Academy';
UPDATE sites SET lat = -1.699609, lng = 29.262378 WHERE name = 'ES Gisenyi';
UPDATE sites SET lat = -2.592537, lng = 29.741538 WHERE name = 'ENDP';
UPDATE sites SET lat = -2.587210, lng = 29.823741 WHERE name = 'ES Gikonko';
-- ES Juru: migration 009 deleted the original SN and renamed Dish 2 → ES Juru
UPDATE sites SET lat = -2.099549, lng = 30.188245 WHERE name = 'ES Juru';
UPDATE sites SET lat = -1.497061, lng = 29.834759 WHERE name = 'ES Kirambo';
UPDATE sites SET lat = -2.132998, lng = 29.313324 WHERE name = 'ES Mubuga - Gishyita';
UPDATE sites SET lat = -2.223665, lng = 29.794185 WHERE name = 'ES Ruhango';
UPDATE sites SET lat = -2.274967, lng = 30.668105 WHERE name = 'ES Rusumo';
UPDATE sites SET lat = -1.838685, lng = 30.245680 WHERE name = 'ES Sancta Maria Karambo';
UPDATE sites SET lat = -1.860271, lng = 30.498743 WHERE name = 'Fawe Gahini';
UPDATE sites SET lat = -1.740319, lng = 30.271863 WHERE name = 'GS Muhura';
UPDATE sites SET lat = -2.035546, lng = 29.423118 WHERE name = 'GS Gihara';
UPDATE sites SET lat = -2.490615, lng = 28.915699 WHERE name = 'GS Gihundwe';
UPDATE sites SET lat = -2.156121, lng = 29.295379 WHERE name = 'GS Gishyita';
UPDATE sites SET lat = -1.443723, lng = 29.575217 WHERE name = 'GS Kinigi';
UPDATE sites SET lat = -2.151169, lng = 30.102872 WHERE name = 'GS Maranyundo';
UPDATE sites SET lat = -1.963569, lng = 30.074911 WHERE name = 'GS Mburabuturo';
UPDATE sites SET lat = -2.385195, lng = 29.715850 WHERE name = 'GS Mubuga II' AND starlink_sn = '2DUNI00000336506';
UPDATE sites SET lat = -2.385192, lng = 29.715769 WHERE name = 'ES Mubuga II'  AND starlink_sn = 'M1HT022110332VMX';
UPDATE sites SET lat = -1.895686, lng = 30.274990 WHERE name = 'GS Nyagasambu';
UPDATE sites SET lat = -2.105273, lng = 30.372425 WHERE name = 'GS Nyange';
UPDATE sites SET lat = -1.678656, lng = 29.520258 WHERE name = 'GS Rambura Filles';
UPDATE sites SET lat = -1.941331, lng = 29.907685 WHERE name = 'GS Remera Indangamirwa';
UPDATE sites SET lat = -1.961752, lng = 30.119193 WHERE name = 'GS Remera Protestant';
UPDATE sites SET lat = -2.699081, lng = 29.009963 WHERE name = 'St Paul Muko';
UPDATE sites SET lat = -1.586470, lng = 29.351672 WHERE name = 'GS St Mathieu - Busasamana';
UPDATE sites SET lat = -1.765395, lng = 29.928928 WHERE name = 'Inyange Girls';
UPDATE sites SET lat = -2.153719, lng = 30.433939 WHERE name = 'Lycee De Zaza';
UPDATE sites SET lat = -1.952456, lng = 30.059213 WHERE name = 'LNDC';
UPDATE sites SET lat = -1.570399, lng = 30.048196 WHERE name = 'GS Notre Dame bon Conseil';
UPDATE sites SET lat = -1.679303, lng = 29.677527 WHERE name = 'Lycee de St Jerome Janja';
UPDATE sites SET lat = -2.152321, lng = 30.101168 WHERE name = 'Maranyundo Girls School';
UPDATE sites SET lat = -2.097049, lng = 29.754632 WHERE name = 'Petit Seminaire St Leon';
UPDATE sites SET lat = -2.470716, lng = 29.589125 WHERE name = 'PS St Jean Paul II';
UPDATE sites SET lat = -1.378844, lng = 30.244278 WHERE name = 'SOPEM Rukomo';
UPDATE sites SET lat = -1.940219, lng = 30.432291 WHERE name = 'Rwamagana Leaders';
UPDATE sites SET lat = -2.335865, lng = 29.092141 WHERE name = 'St Joseph Nyamasheke';
UPDATE sites SET lat = -1.952456, lng = 30.059213 WHERE name = 'Bridge2Rwanda - Headoffice';

-- Count check
DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM sites WHERE lat IS NOT NULL AND lng IS NOT NULL;
  RAISE NOTICE 'Sites with GPS coordinates: %', cnt;
END $$;
