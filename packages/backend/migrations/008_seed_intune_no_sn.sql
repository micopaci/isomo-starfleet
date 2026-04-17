-- Migration 008: Upsert devices with duplicate or missing Windows serial numbers.
-- These are additional Intune Device IDs for the same physical machines,
-- stored with synthetic SNs so intune_device_id can be tracked.

INSERT INTO devices (windows_sn, hostname, manufacturer, intune_device_id, role)
VALUES
  ('INTUNE-2de3b09e', 'Isomo-Dell-1234567', 'Dell Inc.', '2de3b09e-f8a0-4d71-bf0e-ff01a875d492', 'standard'),
  ('INTUNE-09e62209', 'Isomo-HP-JPH00876VB', 'HP', '09e62209-a8ff-4a4c-9a54-d7f94e2a14d5', 'standard'),
  ('INTUNE-37780843', 'Isomo-Dell-5513DB3', 'Dell Inc.', '37780843-8fdd-4726-9346-68c00621f23f', 'standard'),
  ('INTUNE-4dabba8d', 'Isomo-Dell-1234567', 'Dell Inc.', '4dabba8d-22f1-4625-81da-e09021ee8324', 'standard'),
  ('INTUNE-3dd84b78', 'ISOMOACADEMY001', 'HP', '3dd84b78-65f0-42c7-a373-adc70e46ad13', 'standard'),
  ('INTUNE-43bed84f', 'ISOMO-HP-009', 'HP', '43bed84f-41f4-4f28-8d2b-43c422b2ad06', 'standard'),
  ('INTUNE-e63b2b46', 'Isomo-HP-006', 'HP', 'e63b2b46-d152-4330-a88a-9e14f4ab7bde', 'standard'),
  ('INTUNE-844623c8', 'Isomo-5CG84977Z0', 'HP', '844623c8-473e-4c18-bcda-eb3b7c9ed6ee', 'standard'),
  ('INTUNE-28b753cc', 'ISOMO-9PFGP73', 'Dell Inc.', '28b753cc-798b-4fd4-8c37-a81121dfdcd0', 'standard'),
  ('INTUNE-49239ff0', 'ISOMO-2YQ8DB3', 'Dell Inc.', '49239ff0-710e-40dd-ba65-f9a27808c090', 'standard'),
  ('INTUNE-a35c1d8d', 'Isomo-Dell-1MJ3273', 'Dell Inc.', 'a35c1d8d-ae0d-4399-8212-fd013f08f332', 'standard'),
  ('INTUNE-9b9d3abf', 'Isomo-Dell-G48MR73', 'Dell Inc.', '9b9d3abf-3947-4349-b6b7-9e7d52f65230', 'standard'),
  ('INTUNE-3b01d40c', 'Isomo-Dell-1234567', 'Dell Inc.', '3b01d40c-6ea3-44a5-ac20-e2ddb214d1d5', 'standard'),
  ('INTUNE-234da880', 'Isomo-Dell-5CG016B78P', 'HP', '234da880-afc8-447a-aa8e-254bf29cc8e4', 'standard'),
  ('INTUNE-e6d9f790', 'Isomo-Dell-5CG0343PWV', 'HP', 'e6d9f790-85fe-4ca5-99c5-daaf7975a26e', 'standard'),
  ('INTUNE-102399b8', 'ISOMO-HP-132', 'HP', '102399b8-2984-cd39-b3e1-35ebf6ab2ac8', 'standard'),
  ('INTUNE-8eb61357', 'DESKTOP-6O86VQ0', 'HP', '8eb61357-1437-7c23-49c8-35527c8dec8d', 'standard'),
  ('INTUNE-863b65d3', 'ISOMO-HP-013', 'HP', '863b65d3-5174-f1f7-220a-4c748c24d3bf', 'standard'),
  ('INTUNE-0a2a849f', 'PC', 'HP', '0a2a849f-4f8f-1c98-5ccd-9c07f1109a98', 'standard'),
  ('INTUNE-2ed4b29e', 'DESKTOP-23NDN21', 'HP', '2ed4b29e-b833-f576-6e04-f4a152fee29a', 'standard')
ON CONFLICT (intune_device_id) DO UPDATE SET
  hostname     = EXCLUDED.hostname,
  manufacturer = EXCLUDED.manufacturer;
