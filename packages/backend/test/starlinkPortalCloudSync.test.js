const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cookieHeaderFromAuthState,
} = require('../services/starlinkPortalAuth');
const {
  coerceDailyGigabytes,
  parseTerminalStatus,
  parseUsageHistory,
} = require('../services/starlinkPortalCloudSync');

test('parseTerminalStatus maps WebAgg offline flag and lastConnected timestamp', () => {
  const parsed = parseTerminalStatus({
    content: {
      userTerminals: [
        {
          nickname: 'GS Example',
          isOffline: false,
          lastConnected: '2026-06-12T00:04:12.000Z',
          popPingLatencyMs: 37,
          pingDropRate: 0.025,
        },
      ],
    },
  });

  assert.equal(parsed.current_status, 'Online');
  assert.equal(parsed.is_offline, false);
  assert.equal(parsed.nickname, 'GS Example');
  assert.equal(parsed.last_seen_utc, '2026-06-12T00:04:12.000Z');
  assert.equal(parsed.ping_latency_ms, 37);
  assert.equal(parsed.ping_drop_pct, 2.5);
});

test('parseUsageHistory expands billingCyclesAnnotated dailyData and skips future entries', () => {
  const parsed = parseUsageHistory(
    {
      content: {
        billingCyclesAnnotated: [
          {
            startDate: '2026-06-10',
            dailyData: [
              { consumedGB: 3.25 },
              4.5,
              { consumedMb: 1024 },
              0,
              0,
            ],
          },
        ],
      },
    },
    { now: new Date('2026-06-12T12:00:00Z') },
  );

  assert.equal(parsed.active_billing_cycle_start, '2026-06-10');
  assert.deepEqual(
    parsed.history.map(row => [row.log_date, row.consumed_gb]),
    [
      ['2026-06-10', 3.25],
      ['2026-06-11', 4.5],
      ['2026-06-12', 1],
    ],
  );
});

test('coerceDailyGigabytes accepts common telemetry units', () => {
  assert.equal(coerceDailyGigabytes({ consumedBytes: 1073741824 }), 1);
  assert.equal(coerceDailyGigabytes({ mb: 512 }), 0.5);
  assert.equal(coerceDailyGigabytes('7.25'), 7.25);
});

test('cookieHeaderFromAuthState extracts non-expired Starlink cookies only', () => {
  const header = cookieHeaderFromAuthState({
    cookies: [
      { name: 'starlink', value: 'ok', domain: '.starlink.com', expires: 2000000000 },
      { name: 'other', value: 'skip', domain: '.example.com', expires: 2000000000 },
      { name: 'expired', value: 'skip', domain: '.starlink.com', expires: 1 },
    ],
  }, 1000);

  assert.equal(header, 'starlink=ok');
});
