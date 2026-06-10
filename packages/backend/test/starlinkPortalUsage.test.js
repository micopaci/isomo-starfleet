'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeSnapshotDailyTotal,
  normalizePortalEntries,
  resolvePortalSiteId,
} = require('../services/starlinkPortalUsage');
const { previousKigaliWeek } = require('../services/weeklyStarlinkUsageReport');

test('computes daily usage from increasing cumulative portal snapshots', () => {
  assert.deepEqual(computeSnapshotDailyTotal(1_700_000_000, 1_200_000_000), {
    bytes_total: 500_000_000,
    confidence: 'derived_from_snapshot',
    counter_reset_detected: false,
    status: 'ok',
  });
});

test('does not invent a delta for first snapshot', () => {
  assert.deepEqual(computeSnapshotDailyTotal(1_700_000_000, null), {
    bytes_total: null,
    confidence: null,
    counter_reset_detected: false,
    status: 'previous_missing',
  });
});

test('flags billing/payment-cycle counter resets and uses current cumulative value', () => {
  assert.deepEqual(computeSnapshotDailyTotal(80_000_000, 1_200_000_000), {
    bytes_total: 80_000_000,
    confidence: 'cycle_reset_estimate',
    counter_reset_detected: true,
    status: 'counter_reset',
  });
});

test('resolves site identity from explicit id, service line, kit, serial, uuid, or name', () => {
  const siteMap = {
    'SL-025': 25,
    KIT025: 25,
    SN025: 25,
    'ut01000000-00000000-00c00fd2': 25,
    'GS Nyagasambu': 25,
  };

  assert.equal(resolvePortalSiteId({ site_id: 25 }, siteMap), 25);
  assert.equal(resolvePortalSiteId({ service_line_id: 'sl025' }, siteMap), 25);
  assert.equal(resolvePortalSiteId({ kit_id: 'kit-025' }, siteMap), 25);
  assert.equal(resolvePortalSiteId({ starlink_sn: 'sn025' }, siteMap), 25);
  assert.equal(resolvePortalSiteId({ starlink_uuid: '01000000-00000000-00c00fd2' }, siteMap), 25);
  assert.equal(resolvePortalSiteId({ site_name: 'gs  nyagasambu' }, siteMap), 25);
  assert.equal(resolvePortalSiteId({ service_line_id: 'unknown' }, siteMap), null);
});

test('normalizes extracted entries and drops unmapped rows safely', () => {
  const rows = normalizePortalEntries({
    entries: [
      { service_line_id: 'SL-025', gb_used_cumulative: 12.3 },
      { service_line_id: 'unknown', gb_used_cumulative: 45.6 },
    ],
  }, { 'SL-025': 25 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].site_id, 25);
});

test('previous Kigali week returns prior Monday-through-Sunday window', () => {
  assert.deepEqual(previousKigaliWeek(new Date('2026-06-10T20:00:00.000Z')), {
    start: '2026-06-01',
    end: '2026-06-08',
  });
});
