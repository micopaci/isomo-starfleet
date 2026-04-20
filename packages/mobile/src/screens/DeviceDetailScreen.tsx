/**
 * DeviceDetailScreen — detailed view for a single computer/device.
 *
 * Shows:
 *  • Online/stale/offline status with last-seen time
 *  • Device info (hostname, site, manufacturer, serial, role)
 *  • Health metrics when available (battery, disk, RAM)
 *  • Admin actions: pull data, location refresh
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, useColorScheme,
} from 'react-native';
import { getApi, getToken, decodeJwtPayload } from '../store/auth';
import { Device, DeviceHealth } from '@starfleet/shared';
import { DeviceDetailProps } from '../navigation/types';
import { light, dark, Colors } from '../theme/colors';
import { StatusChip } from '../components/StatusChip';

export function DeviceDetailScreen({ route, navigation }: DeviceDetailProps) {
  const { deviceId, deviceName, siteId } = route.params;
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const [device,   setDevice]   = useState<Device | null>(null);
  const [health,   setHealth]   = useState<DeviceHealth | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [pulling,  setPulling]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const token   = getToken();
  const isAdmin = token ? (decodeJwtPayload(token) as any)?.role === 'admin' : false;

  useEffect(() => {
    navigation.setOptions({ title: deviceName });
    fetchDevice();
  }, [deviceId]);

  async function fetchDevice() {
    setLoading(true); setError('');
    try {
      const api = getApi();
      if (!api) throw new Error('Not connected');
      const devices = await api.getDevices();
      const d = devices.find(x => x.id === deviceId) ?? null;
      setDevice(d);

      // Try to fetch health record
      try {
        const h = await (api as any).get(`/devices/${deviceId}/health`).catch(() => null);
        if (h && h.id) setHealth(h);
      } catch {}
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(type: 'data_pull' | 'location_refresh') {
    const api = getApi();
    if (!api || !device) return;
    if (type === 'data_pull') setPulling(true);
    else setRefreshing(true);
    setActionMsg('');
    try {
      await api.triggerScript(device.id, type);
      setActionMsg(type === 'data_pull' ? 'Data pull triggered ✓' : 'Location refresh triggered ✓');
      setTimeout(() => setActionMsg(''), 4000);
    } catch (e: any) {
      setActionMsg(`Failed: ${e?.message ?? 'Unknown error'}`);
    } finally {
      setPulling(false);
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <Text style={[styles.errorText, { color: C.bad }]}>{error}</Text>
        <TouchableOpacity onPress={fetchDevice} style={[styles.retryBtn, { borderColor: C.accent }]}>
          <Text style={{ color: C.accent }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <Text style={[styles.errorText, { color: C.muted }]}>Device not found</Text>
      </View>
    );
  }

  const isOnline = device.last_seen &&
    Date.now() - new Date(device.last_seen).getTime() < 10 * 60_000;
  const chipStatus: 'online' | 'stale' | 'offline' =
    isOnline ? 'online' : device.status === 'stale' ? 'stale' : 'offline';

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.bg }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    >

      {/* Status card */}
      <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
        <View style={styles.statusRow}>
          <StatusChip status={chipStatus} colors={C} />
          {device.role === 'agent' && (
            <View style={[styles.roleBadge, { backgroundColor: C.accentSoft }]}>
              <Text style={[styles.roleText, { color: C.accentInk }]}>AGENT</Text>
            </View>
          )}
        </View>

        <InfoRow label="Device name"  value={device.hostname ?? '—'}                        C={C} />
        <InfoRow label="Site"         value={device.site_name ?? '—'}                       C={C} />
        <InfoRow label="Last seen"    value={device.last_seen
          ? `${new Date(device.last_seen).toLocaleString()} (${formatAgo(new Date(device.last_seen))})`
          : 'Never'}                                                                         C={C} />
        <InfoRow label="Manufacturer" value={device.manufacturer ?? '—'}                    C={C} />
        <InfoRow label="Windows S/N"  value={device.windows_sn ?? '—'}                      C={C} mono />
        {device.intune_device_id && (
          <InfoRow label="Intune ID"  value={device.intune_device_id}                       C={C} mono />
        )}
      </View>

      {/* Health metrics */}
      {health && (
        <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <Text style={[styles.cardTitle, { color: C.ink }]}>Health</Text>
          <View style={styles.healthGrid}>
            {health.battery_pct != null && (
              <HealthTile
                label="Battery"
                value={`${health.battery_pct}%`}
                color={health.battery_pct > 20 ? C.ok : C.bad}
                C={C}
              />
            )}
            {health.battery_health_pct != null && (
              <HealthTile
                label="Batt. Health"
                value={`${health.battery_health_pct}%`}
                color={health.battery_health_pct > 80 ? C.ok : health.battery_health_pct > 50 ? C.warn : C.bad}
                C={C}
              />
            )}
            {health.disk_free_gb != null && health.disk_total_gb != null && (
              <HealthTile
                label="Disk Free"
                value={`${health.disk_free_gb.toFixed(0)} / ${health.disk_total_gb.toFixed(0)} GB`}
                color={health.disk_free_gb > 10 ? C.ok : health.disk_free_gb > 3 ? C.warn : C.bad}
                C={C}
              />
            )}
            {health.ram_used_mb != null && health.ram_total_mb != null && (
              <HealthTile
                label="RAM"
                value={`${(health.ram_used_mb / 1024).toFixed(1)} / ${(health.ram_total_mb / 1024).toFixed(1)} GB`}
                color={C.ink2}
                C={C}
              />
            )}
          </View>
          <Text style={[styles.healthTimestamp, { color: C.muted }]}>
            Recorded {new Date(health.recorded_at).toLocaleString()}
          </Text>
        </View>
      )}

      {/* Admin actions */}
      {isAdmin && (
        <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <Text style={[styles.cardTitle, { color: C.ink }]}>Admin Actions</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: C.accent }]}
              onPress={() => handleAction('data_pull')}
              disabled={pulling || refreshing}
            >
              {pulling
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.actionBtnText}>⬇ Pull Data</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.accent }]}
              onPress={() => handleAction('location_refresh')}
              disabled={pulling || refreshing}
            >
              {refreshing
                ? <ActivityIndicator color={C.accent} size="small" />
                : <Text style={[styles.actionBtnText, { color: C.accent }]}>📍 Location</Text>}
            </TouchableOpacity>
          </View>
          {!!actionMsg && (
            <Text style={[styles.actionMsg, { color: actionMsg.startsWith('Failed') ? C.bad : C.ok }]}>
              {actionMsg}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({
  label, value, C, mono = false,
}: { label: string; value: string; C: Colors; mono?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: C.ink3 }]}>{label}</Text>
      <Text
        style={[styles.infoValue, { color: C.ink, fontFamily: mono ? 'monospace' : undefined }]}
        numberOfLines={1}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

function HealthTile({
  label, value, color, C,
}: { label: string; value: string; color: string; C: Colors }) {
  return (
    <View style={[styles.healthTile, { backgroundColor: C.surface2, borderColor: C.rule }]}>
      <Text style={[styles.healthValue, { color }]}>{value}</Text>
      <Text style={[styles.healthLabel, { color: C.muted }]}>{label}</Text>
    </View>
  );
}

function formatAgo(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:          { flex: 1 },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  card:            { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12, gap: 8 },
  cardTitle:       { fontWeight: '600', fontSize: 14, marginBottom: 4 },
  statusRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  roleBadge:       { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  roleText:        { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  infoRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                     paddingVertical: 4 },
  infoLabel:       { fontSize: 12, flex: 0.42 },
  infoValue:       { fontSize: 13, fontWeight: '500', flex: 0.58, textAlign: 'right' },
  healthGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  healthTile:      { borderRadius: 8, borderWidth: 1, padding: 10, minWidth: '47%', flex: 1 },
  healthValue:     { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  healthLabel:     { fontSize: 11 },
  healthTimestamp: { fontSize: 11, marginTop: 4, textAlign: 'right' },
  actionsRow:      { flexDirection: 'row', gap: 8 },
  actionBtn:       { flex: 1, borderRadius: 8, padding: 12, alignItems: 'center' },
  actionBtnText:   { color: '#fff', fontWeight: '600', fontSize: 13 },
  actionMsg:       { fontSize: 12, textAlign: 'center', marginTop: 4 },
  errorText:       { fontSize: 14 },
  retryBtn:        { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
});
