'use strict';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickStatusEnvelope(payload) {
  if (isPlainObject(payload?.dishGetStatus)) {
    return { source: 'local_grpc', status: payload.dishGetStatus };
  }
  if (isPlainObject(payload?.dish?.rawStatus)) {
    return { source: 'cloud_debug', status: payload.dish.rawStatus };
  }
  if (isPlainObject(payload?.rawStatus)) {
    return { source: 'cloud_debug', status: payload.rawStatus };
  }
  if (isPlainObject(payload)) {
    return { source: 'unknown', status: payload };
  }
  return { source: 'unknown', status: {} };
}

function pickRouterEnvelope(payload) {
  if (isPlainObject(payload?.router?.rawStatus)) {
    return { source: 'cloud_debug', router: payload.router.rawStatus };
  }
  if (isPlainObject(payload?.routerStatus)) {
    return { source: 'local_grpc', router: payload.routerStatus };
  }
  if (isPlainObject(payload?.router)) {
    return { source: 'unknown', router: payload.router };
  }
  return { source: 'unknown', router: null };
}

function asText(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function asNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }
  return null;
}

function activeAlertNames(alerts) {
  if (!isPlainObject(alerts)) return [];
  return Object.entries(alerts)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort();
}

function normalizeReadyStates(readyStates) {
  if (!isPlainObject(readyStates)) return null;
  const normalized = {};
  for (const [key, value] of Object.entries(readyStates)) {
    const normalizedKey = key === 'l1L2' ? 'l1l2' : key;
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function fractionToPct(value) {
  const n = asNumber(value);
  if (n === null) return null;
  return n <= 1 ? Math.round(n * 10000) / 100 : Math.round(n * 100) / 100;
}

function bpsToMbps(value) {
  const n = asNumber(value);
  if (n === null) return null;
  return Math.round((n / 1000000) * 100) / 100;
}

function normalizeStarlinkId(value) {
  const text = asText(value)?.trim().toLowerCase();
  if (!text) return null;
  const prefixed = text.match(/^ut([0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8})$/);
  if (prefixed) return prefixed[1];
  if (/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/.test(text)) return text;
  return null;
}

function parseDishTelemetry(payload) {
  const { source, status } = pickStatusEnvelope(payload);
  const deviceInfo = status.deviceInfo || {};
  const obstructionStats = status.obstructionStats || {};
  const alerts = isPlainObject(status.alerts) ? status.alerts : {};
  const readyStates = normalizeReadyStates(status.readyStates);
  const starlinkId = asText(deviceInfo.id || status.id);
  const outage = isPlainObject(status.outage) ? status.outage : null;

  return {
    source,
    starlink_id: starlinkId,
    starlink_uuid: normalizeStarlinkId(starlinkId),
    hardware_version: asText(deviceInfo.hardwareVersion || payload?.dish?.hardwareVersion),
    software_version: asText(deviceInfo.softwareVersion),
    is_snr_above_noise_floor: asBoolean(status.isSnrAboveNoiseFloor),
    is_snr_persistently_low: asBoolean(status.isSnrPersistentlyLow),
    starlink_alerts: alerts,
    active_alerts: activeAlertNames(alerts),
    disablement_code: asText(status.disablementCode),
    ready_states: readyStates,
    dl_bandwidth_restricted_reason: asText(status.dlBandwidthRestrictedReason),
    ul_bandwidth_restricted_reason: asText(status.ulBandwidthRestrictedReason),
    dish_uptime_s: asNumber(status.deviceState?.uptimeS),
    dish_bootcount: asNumber(deviceInfo.bootcount),
    reboot_reason: asText(deviceInfo.rebootReason || status.rebootReason),
    obstruction_pct: fractionToPct(obstructionStats.fractionObstructed),
    currently_obstructed: asBoolean(obstructionStats.currentlyObstructed),
    outage,
    software_update_state: asText(status.softwareUpdateState),
    pop_latency_ms: asNumber(status.popPingLatencyMs),
    download_mbps: bpsToMbps(status.downlinkThroughputBps),
    upload_mbps: bpsToMbps(status.uplinkThroughputBps),
  };
}

function parseRouterTelemetry(payload) {
  const { source, router } = pickRouterEnvelope(payload);
  if (!router) return null;
  const alerts = isPlainObject(router.alerts) ? router.alerts : {};
  const poeStats = router.poeStats || {};
  const boot = router.deviceInfo?.boot || router.boot || {};

  return {
    source,
    no_wan_link: asBoolean(router.noWanLink),
    router_alerts: alerts,
    active_alerts: activeAlertNames(alerts),
    poe_vin_undervoltage: asBoolean(alerts.poeVinUndervoltage),
    poe_vin_overvoltage: asBoolean(alerts.poeVinOvervoltage),
    poe_on_dish_unreachable: asBoolean(alerts.poeOnDishUnreachable),
    poe_vin: asNumber(poeStats.vsnsVin),
    router_bootcount: asNumber(router.deviceInfo?.bootcount),
    boot_count_by_reason: isPlainObject(boot.countByReason) ? boot.countByReason : null,
  };
}

function isOkDisablement(value) {
  if (value === null || value === undefined || value === '') return true;
  return /^(okay|ok|1)$/i.test(String(value));
}

function failedReadyStates(readyStates) {
  if (!isPlainObject(readyStates)) return [];
  const coreReadyStates = new Set(['scp', 'l1l2', 'xphy', 'aap', 'rf']);
  return Object.entries(readyStates)
    .filter(([key, value]) => coreReadyStates.has(key) && value === false)
    .map(([key]) => key)
    .sort();
}

function classifyAttribution({ dish, router, previousRouter }) {
  if (router?.poe_vin_undervoltage || router?.poe_vin_overvoltage) {
    return { verdict: 'local_power_fault', confidence: 'high' };
  }
  if (router?.poe_on_dish_unreachable) {
    return { verdict: 'dish_power_or_cable_fault', confidence: 'high' };
  }
  if (
    router?.router_bootcount !== null &&
    router?.router_bootcount !== undefined &&
    previousRouter?.router_bootcount !== null &&
    previousRouter?.router_bootcount !== undefined &&
    router.router_bootcount > previousRouter.router_bootcount
  ) {
    return { verdict: 'router_power_cycle', confidence: 'high' };
  }
  if (router?.no_wan_link === true) {
    return { verdict: 'starlink_wan_or_service_fault', confidence: 'high' };
  }
  if (dish?.outage) {
    return { verdict: 'starlink_reported_outage', confidence: 'high' };
  }
  if (!isOkDisablement(dish?.disablement_code)) {
    return { verdict: 'account_or_service_disabled', confidence: 'high' };
  }

  const failed = failedReadyStates(dish?.ready_states);
  if (failed.length > 0) {
    return { verdict: 'dish_not_ready', confidence: 'medium', failed_ready_states: failed };
  }
  if (dish?.obstruction_pct !== null && dish.obstruction_pct > 5) {
    return { verdict: 'physical_obstruction', confidence: 'high' };
  }
  if (
    dish?.is_snr_above_noise_floor === false ||
    dish?.is_snr_persistently_low === true ||
    dish?.active_alerts?.includes('lowerSignalThanPredicted')
  ) {
    return { verdict: 'dish_signal_degraded', confidence: 'medium' };
  }
  if (dish?.software_update_state && !/^idle$/i.test(dish.software_update_state)) {
    return { verdict: 'software_update_or_install_pending', confidence: 'medium' };
  }
  return { verdict: 'nominal', confidence: 'high' };
}

module.exports = {
  activeAlertNames,
  classifyAttribution,
  normalizeReadyStates,
  parseDishTelemetry,
  parseRouterTelemetry,
};
