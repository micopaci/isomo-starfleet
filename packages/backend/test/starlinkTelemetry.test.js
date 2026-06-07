'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  classifyAttribution,
  parseDishTelemetry,
  parseRouterTelemetry,
} = require('../services/starlinkTelemetry');

const fixtureDir = path.join(__dirname, 'fixtures', 'starlink-telemetry');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('parses local Gen 3 gRPC status with string enums and omitted false alerts', () => {
  const dish = parseDishTelemetry(fixture('local-gen3-ok.json'));

  assert.equal(dish.source, 'local_grpc');
  assert.equal(dish.starlink_id, 'ut31c88996-c611791c-599d1851');
  assert.equal(dish.starlink_uuid, '31c88996-c611791c-599d1851');
  assert.equal(dish.disablement_code, 'OKAY');
  assert.equal(dish.dl_bandwidth_restricted_reason, 'NO_LIMIT');
  assert.deepEqual(dish.active_alerts, []);
  assert.equal(dish.is_snr_above_noise_floor, true);
  assert.equal(dish.ready_states.l1l2, true);
  assert.equal(dish.obstruction_pct, 0.09);
  assert.equal(dish.download_mbps, 2.18);

  assert.deepEqual(classifyAttribution({ dish }), {
    verdict: 'nominal',
    confidence: 'high',
  });
});

test('keeps cloud debug numeric enums as text and normalizes l1L2 ready state', () => {
  const dish = parseDishTelemetry(fixture('cloud-debug-mini-alerts.json'));

  assert.equal(dish.source, 'cloud_debug');
  assert.equal(dish.hardware_version, 'mini1_panda_prod1');
  assert.equal(dish.disablement_code, '1');
  assert.equal(dish.dl_bandwidth_restricted_reason, '1');
  assert.equal(dish.ready_states.l1l2, true);
  assert.deepEqual(dish.active_alerts, ['lowerSignalThanPredicted']);
  assert.equal(dish.obstruction_pct, 5.03);

  assert.deepEqual(classifyAttribution({ dish }), {
    verdict: 'physical_obstruction',
    confidence: 'high',
  });
});

test('classifies non-OK local disablement before signal alerts', () => {
  const dish = parseDishTelemetry(fixture('local-disabled-alert.json'));

  assert.equal(dish.disablement_code, 'UNAUTHORIZED');
  assert.deepEqual(dish.active_alerts, ['lowerSignalThanPredicted']);
  assert.deepEqual(classifyAttribution({ dish }), {
    verdict: 'account_or_service_disabled',
    confidence: 'high',
  });
});

test('captures Starlink-reported outage as raw attribution evidence', () => {
  const dish = parseDishTelemetry(fixture('local-outage-cause13.json'));

  assert.equal(dish.outage.cause, 13);
  assert.equal(dish.pop_latency_ms, -1);
  assert.deepEqual(classifyAttribution({ dish }), {
    verdict: 'starlink_reported_outage',
    confidence: 'high',
  });
});

test('parses router PoE evidence for local power attribution', () => {
  const router = parseRouterTelemetry(fixture('cloud-router-power-instability.json'));

  assert.equal(router.source, 'cloud_debug');
  assert.equal(router.poe_vin_undervoltage, true);
  assert.equal(router.poe_vin, 47.2);
  assert.equal(router.router_bootcount, 1620);
  assert.equal(router.boot_count_by_reason['1'], 1576);
  assert.deepEqual(router.active_alerts, ['poeVinUndervoltage']);

  assert.deepEqual(classifyAttribution({ router }), {
    verdict: 'local_power_fault',
    confidence: 'high',
  });
});

test('detects router power cycling from bootcount delta', () => {
  const previousRouter = { router_bootcount: 1619 };
  const router = {
    ...parseRouterTelemetry(fixture('cloud-router-power-instability.json')),
    poe_vin_undervoltage: false,
  };

  assert.deepEqual(classifyAttribution({ router, previousRouter }), {
    verdict: 'router_power_cycle',
    confidence: 'high',
  });
});

test('attributes an unreachable dish gRPC to a suspected power outage', () => {
  // Laptop alive (it reported) but could not reach the dish at 192.168.100.1.
  assert.deepEqual(classifyAttribution({ dish: { dish_grpc_reachable: false } }), {
    verdict: 'power_outage_suspected',
    confidence: 'medium',
  });
});

test('a reachable, all-clear dish is nominal, not a power outage', () => {
  const dish = parseDishTelemetry(fixture('local-gen3-ok.json'));
  dish.dish_grpc_reachable = true;
  assert.deepEqual(classifyAttribution({ dish }), {
    verdict: 'nominal',
    confidence: 'high',
  });
});
