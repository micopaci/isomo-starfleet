const PLACEHOLDER_SERIALS = new Set([
  '',
  '0',
  '00000000',
  'DEFAULTSTRING',
  'NONE',
  'NULL',
  'N/A',
  'NA',
  'SYSTEMSERIALNUMBER',
  'TOBEFILLEDBYO.E.M.',
  'TOBEFILLEDBYOEM',
  'UNKNOWN',
]);

function normalizeText(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  return value || null;
}

function normalizeSerial(raw) {
  const value = normalizeText(raw);
  if (!value) return null;

  const compact = value.toUpperCase().replace(/\s+/g, '');
  if (PLACEHOLDER_SERIALS.has(compact)) return null;
  return compact;
}

function syntheticWindowsSerial(intuneId) {
  return `INTUNE-${String(intuneId).replace(/-/g, '').slice(0, 8)}`;
}

module.exports = {
  normalizeText,
  normalizeSerial,
  syntheticWindowsSerial,
};
