'use strict';

function normalizeIdentity(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.toLowerCase().replace(/^ut/, '').replace(/[^a-z0-9]+/g, '');
}

function computeSnapshotDailyTotal(currentBytes, previousBytes) {
  const current = Number(currentBytes);
  if (!Number.isFinite(current) || current < 0) {
    return { bytes_total: null, confidence: null, counter_reset_detected: false, status: 'invalid_current' };
  }

  if (previousBytes === undefined || previousBytes === null || previousBytes === '') {
    return { bytes_total: null, confidence: null, counter_reset_detected: false, status: 'previous_missing' };
  }

  const previous = Number(previousBytes);
  if (!Number.isFinite(previous) || previous < 0) {
    return { bytes_total: null, confidence: null, counter_reset_detected: false, status: 'previous_missing' };
  }

  if (current >= previous) {
    return {
      bytes_total: Math.round(current - previous),
      confidence: 'derived_from_snapshot',
      counter_reset_detected: false,
      status: 'ok',
    };
  }

  return {
    bytes_total: Math.round(current),
    confidence: 'cycle_reset_estimate',
    counter_reset_detected: true,
    status: 'counter_reset',
  };
}

function resolvePortalSiteId(entry = {}, siteMap = {}) {
  const explicit = Number(entry.site_id);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;

  const normalizedMap = new Map();
  for (const [key, value] of Object.entries(siteMap || {})) {
    const normalized = normalizeIdentity(key);
    const siteId = Number(value);
    if (normalized && Number.isInteger(siteId) && siteId > 0) {
      normalizedMap.set(normalized, siteId);
    }
  }

  const candidates = [
    entry.service_line_id,
    entry.serviceLineId,
    entry.service_line_number,
    entry.starlink_identifier,
    entry.starlink_uuid,
    entry.starlink_sn,
    entry.kit_id,
    entry.terminal_id,
    entry.nickname,
    entry.site_name,
    entry.name,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeIdentity(candidate);
    if (normalized && normalizedMap.has(normalized)) {
      return normalizedMap.get(normalized);
    }
  }

  return null;
}

function normalizePortalEntries(raw, siteMap = {}) {
  const entries = Array.isArray(raw) ? raw : raw?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('Usage extraction must return an array or { entries: [...] }');
  }

  return entries
    .map(entry => ({
      ...entry,
      site_id: resolvePortalSiteId(entry, siteMap),
    }))
    .filter(entry => Number.isInteger(entry.site_id) && entry.site_id > 0);
}

module.exports = {
  computeSnapshotDailyTotal,
  normalizeIdentity,
  normalizePortalEntries,
  resolvePortalSiteId,
};
