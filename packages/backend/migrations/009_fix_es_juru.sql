-- Remove the wrong ES Juru (KIT302394513 / 2DUNI00000100892)
DELETE FROM sites WHERE starlink_sn = '2DUNI00000100892';

-- Re-insert the correct ES Juru (KIT4M02111538JR / M1HT022172551989)
INSERT INTO sites (name, starlink_sn, kit_id, location)
VALUES ('ES Juru', 'M1HT022172551989', 'KIT4M02111538JR', 'V5XQ+FF5 Juru, Rwanda')
ON CONFLICT (starlink_sn) DO UPDATE
  SET name = 'ES Juru', kit_id = 'KIT4M02111538JR', location = 'V5XQ+FF5 Juru, Rwanda';
