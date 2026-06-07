# Starlink Telemetry Attribution Design Note

Date: 2026-06-07
Scope: Validate Starlink dish/router telemetry fields before driving dashboard attribution from `packages/agent/StarfleetAgent.ps1`.

## Decision

Use local dish gRPC as the production contract. The agent probes `192.168.100.1:9200` with `get_status`; cloud/mobile-app debug exports are useful for field discovery, but they are not the exact serialization shape the agent sees.

The parser must therefore accept the local gRPC shape first:

- `dishGetStatus.disablementCode`: string enum, for example `OKAY`.
- `dishGetStatus.dlBandwidthRestrictedReason`: string enum, for example `NO_LIMIT`.
- `dishGetStatus.ulBandwidthRestrictedReason`: string enum, for example `NO_LIMIT`.
- `dishGetStatus.alerts`: object where all-clear may be `{}` and absent keys mean false.
- `dishGetStatus.readyStates`: object with `scp`, `l1l2`, `xphy`, `aap`, `rf`.

Cloud/mobile-app debug exports serialize the same field universe differently:

- enum fields may be numeric, for example `1`.
- all-clear `alerts` may enumerate every alert key as `false`.
- `readyStates.l1l2` may appear as `l1L2`.
- hardware identity in filenames is not reliable; use `dish.hardwareVersion` and `dish.rawStatus.deviceInfo.hardwareVersion`.

## Field Matrix

| Signal | Local gRPC path | Cloud debug path | Store as | Notes |
|---|---|---|---|---|
| Dish ID | `dishGetStatus.deviceInfo.id` | `dish.rawStatus.deviceInfo.id` | `starlink_id`, `starlink_uuid` | Site identity key. |
| Hardware version | `dishGetStatus.deviceInfo.hardwareVersion` | `dish.rawStatus.deviceInfo.hardwareVersion` | diagnostic text | Use for validation, not site identity. |
| Software version | `dishGetStatus.deviceInfo.softwareVersion` | `dish.rawStatus.deviceInfo.softwareVersion` | diagnostic text | Useful for rollout correlation. |
| SNR above floor | `dishGetStatus.isSnrAboveNoiseFloor` | `dish.rawStatus.isSnrAboveNoiseFloor` | boolean | Primary replacement for numeric SNR. |
| SNR persistently low | `dishGetStatus.isSnrPersistentlyLow` | `dish.rawStatus.isSnrPersistentlyLow` | boolean | Useful for degraded-signal attribution if present. |
| Alerts | `dishGetStatus.alerts` | `dish.rawStatus.alerts` | JSONB | Treat absent alert keys as false. |
| Active alert names | derived from `alerts` true keys | derived from `alerts` true keys | derived array | Do not persist separately unless UI needs it. |
| Disablement code | `dishGetStatus.disablementCode` | `dish.rawStatus.disablementCode` | text | String on local gRPC, numeric enum in cloud debug. |
| Ready states | `dishGetStatus.readyStates` | `dish.rawStatus.readyStates` | JSONB | Normalize `l1L2` to `l1l2` for classifier logic. |
| DL restriction reason | `dishGetStatus.dlBandwidthRestrictedReason` | `dish.rawStatus.dlBandwidthRestrictedReason` | text | String on local gRPC, numeric enum in cloud debug. |
| UL restriction reason | `dishGetStatus.ulBandwidthRestrictedReason` | `dish.rawStatus.ulBandwidthRestrictedReason` | text | Same rule as DL. |
| Dish uptime | `dishGetStatus.deviceState.uptimeS` | `dish.rawStatus.deviceState.uptimeS` | bigint | Often encoded as string. |
| Dish boot count | `dishGetStatus.deviceInfo.bootcount` | `dish.rawStatus.deviceInfo.bootcount` | integer | Rising count between polls can indicate power cycling. |
| Reboot reason | `dishGetStatus.deviceInfo.rebootReason` | `dish.rawStatus.deviceInfo.rebootReason` | diagnostic text/int | Capture if present. |
| Obstruction fraction | `dishGetStatus.obstructionStats.fractionObstructed` | `dish.rawStatus.obstructionStats.fractionObstructed` | numeric percent | Store current `obstruction_pct = fraction * 100`. |
| Currently obstructed | `dishGetStatus.obstructionStats.currentlyObstructed` | `dish.rawStatus.obstructionStats.currentlyObstructed` | boolean | Useful immediate obstruction flag. |
| Outage | `dishGetStatus.outage` | `dish.rawStatus.outage` | JSONB | Capture cause/duration when present. |
| Software update state | `dishGetStatus.softwareUpdateState` | `dish.rawStatus.softwareUpdateState` | text | Distinguish update/reboot from fault. |
| Pop latency | `dishGetStatus.popPingLatencyMs` | `dish.rawStatus.popPingLatencyMs` | numeric | `-1` can pair with outage. |
| Throughput | `downlinkThroughputBps`, `uplinkThroughputBps` | same under `rawStatus` | Mbps numeric | Existing agent conversion remains valid. |

Router fields are a second contract and should be parsed separately when the agent can reach router status:

| Signal | Router debug path | Store as | Notes |
|---|---|---|---|
| Router reachable | `router.reachable` | boolean | Basic router API health. |
| no WAN link | `router.rawStatus.noWanLink` | boolean | Direct router view of satellite/WAN link. |
| Router alerts | `router.rawStatus.alerts` | JSONB | Includes PoE and WAN fault flags. |
| PoE undervoltage | `router.rawStatus.alerts.poeVinUndervoltage` | boolean | Strong local-power indicator. |
| PoE overvoltage | `router.rawStatus.alerts.poeVinOvervoltage` | boolean | Strong local-power indicator. |
| PoE dish unreachable | `router.rawStatus.alerts.poeOnDishUnreachable` | boolean | Router sees dish path down. |
| Input voltage | `router.rawStatus.poeStats.vsnsVin` | numeric | Healthy examples are around 57 V. |
| Router boot count | `router.rawStatus.deviceInfo.bootcount` | integer | Rising count indicates router power cycling. |
| Boot reason histogram | `router.rawStatus.deviceInfo.boot.countByReason` | JSONB | High uncommanded/power-like counts are a power-instability fingerprint. |

## Attribution Truth Table

| Condition | Verdict | Confidence | Action |
|---|---|---|---|
| Local dish gRPC unreachable from laptop | `power_outage_suspected` | medium | Record `dish_grpc_reachable=false`; do not use laptop battery. |
| Router PoE undervoltage/overvoltage true | `local_power_fault` | high | Surface as site power issue. |
| Router `poeOnDishUnreachable=true` and router reachable | `dish_power_or_cable_fault` | high | Site visit: inspect Starlink power path/cable. |
| Router boot count rises between polls | `router_power_cycle` | high | Track as power instability; compare with grid reports. |
| Router boot reason histogram shows large non-clean counts | `historical_power_instability` | medium | Use as retroactive fingerprint, not a single-event proof. |
| Router `noWanLink=true`, dish reachable, no PoE fault | `starlink_wan_or_service_fault` | high | Likely Starlink/network side, not school LAN. |
| Dish `outage.cause` present | `starlink_reported_outage` | high | Preserve raw outage JSON for retroactive attribution. |
| `disablementCode` not OK/OKAY/1 | `account_or_service_disabled` | high | Escalate service/account state. |
| Any `readyStates` value false, especially `rf=false` | `dish_not_ready` | medium | Show failed subsystem names. |
| `alerts.lowerSignalThanPredicted=true` or `isSnrAboveNoiseFloor=false` | `dish_signal_degraded` | medium | Correlate with obstruction/weather. |
| `obstruction_pct > 5` | `physical_obstruction` | high | Site visit: line-of-sight issue. |
| `softwareUpdateState` not idle or install/update alert true | `software_update_or_install_pending` | medium | Avoid classifying as outage until update window passes. |

Battery discharge is explicitly excluded. Student laptops are commonly unplugged, so laptop battery drain is not evidence of site power loss.

## Parser Rules

1. Prefer `dishGetStatus` for local gRPC.
2. Use `dish.rawStatus` only for cloud/debug fixtures and offline analysis.
3. Store enum-like values as text because local and cloud encodings differ.
4. Treat missing alert keys as false; only `true` keys are active.
5. Normalize `readyStates.l1L2` to `readyStates.l1l2` for classifier logic.
6. Capture unknown alert/outage/router fields as JSON instead of trying to pre-enumerate every Starlink firmware variant.
7. Preserve raw outage and router boot histogram when present; those are attribution evidence, not simple scalar metrics.

## Test Strategy

Golden fixtures should cover:

- local Gen 3 all-clear response with string enums and `{}` alerts.
- local disabled/alert response with string enum and active alert.
- local outage response with `outage.cause`.
- cloud/debug dish response with numeric enum values and enumerated false alerts.
- cloud/debug router response with PoE/power and boot-reason evidence.

The production agent should run in shadow mode first: emit fields, store them, and show internal diagnostics before making them drive visible dashboard severity.
