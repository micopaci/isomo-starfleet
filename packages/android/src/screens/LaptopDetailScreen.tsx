import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, useColorScheme,
} from 'react-native';
import { getApi, decodeJwtPayload, getToken } from '../store/auth';
import { Device } from '@starfleet/shared';
import { LaptopDetailProps } from '../navigation/types';
import { light, dark, Colors } from '../theme/colors';

export function LaptopDetailScreen({ route }: LaptopDetailProps) {
  const { deviceId, siteId } = route.params;
  const scheme = useColorScheme();
  const colors: Colors = scheme === 'dark' ? dark : light;

  const [device,   setDevice]   = useState<Device | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [pulling,  setPulling]  = useState(false);
  const [pullMsg,  setPullMsg]  = useState('');

  const token = getToken();
  const isAdmin = token
    ? (decodeJwtPayload(token) as any)?.role === 'admin'
    : false;

  useEffect(() => {
    fetchDevice();
  }, [deviceId]);

  async function fetchDevice() {
    setLoading(true); setError('');
    try {
      const api = getApi();
      if (!api) throw new Error('Not connected');
      const devices = await api.getDevices();
      const d = devices.find(x => x.id === deviceId);
      setDevice(d ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function handlePull() {
    const api = getApi();
    if (!api || !device) return;
    setPulling(true); setPullMsg('');
    try {
      await api.triggerScript(device.id, 'data_pull');
      setPullMsg('Data pull triggered ✓');
    } catch (e: any) {
      setPullMsg(`Failed: ${e?.message}`);
    } finally {
      setPulling(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#ef4444' }}>{error}</Text>
        <TouchableOpacity onPress={fetchDevice}><Text style={{ color: colors.accent }}>Retry</Text></TouchableOpacity>
      </View>
    );
  }
  if (!device) {
    return <View style={styles.center}><Text style={{ color: colors.text2 }}>Device not found</Text></View>;
  }

  const isOnline = device.last_seen &&
    Date.now() - new Date(device.last_seen).getTime() < 10 * 60_000;

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Status badge */}
      <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
        <View style={styles.row}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? '#22c55e' : '#94a3b8' }]} />
          <Text style={[styles.status, { color: isOnline ? '#22c55e' : colors.text2 }]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>

        <Row label="Device name"  value={device.hostname ?? '—'}       colors={colors} />
        <Row label="Site"         value={device.site_name ?? '—'}      colors={colors} />
        <Row label="Last seen"    value={device.last_seen
          ? new Date(device.last_seen).toLocaleString() : 'Never'}     colors={colors} />
        <Row label="Manufacturer" value={device.manufacturer ?? '—'}   colors={colors} />
        <Row label="Windows S/N"  value={device.windows_sn ?? '—'}     colors={colors} />
        <Row label="Role"         value={device.role ?? '—'}           colors={colors} />
      </View>

      {/* Admin actions */}
      {isAdmin && (
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Admin Actions</Text>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accent }]}
            onPress={handlePull}
            disabled={pulling}
          >
            {pulling
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.actionBtnText}>Pull data now</Text>}
          </TouchableOpacity>
          {!!pullMsg && <Text style={[styles.pullMsg, { color: colors.text2 }]}>{pullMsg}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

function Row({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.text2 }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, padding: 16 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  card:         { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 12, gap: 10 },
  cardTitle:    { fontWeight: '600', fontSize: 14, marginBottom: 8 },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:    { width: 8, height: 8, borderRadius: 99 },
  status:       { fontWeight: '600', fontSize: 14 },
  infoRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel:    { fontSize: 12, flex: 0.45 },
  infoValue:    { fontSize: 13, fontWeight: '500', flex: 0.55, textAlign: 'right' },
  actionBtn:    { borderRadius: 8, padding: 12, alignItems: 'center' },
  actionBtnText:{ color: '#fff', fontWeight: '600', fontSize: 14 },
  pullMsg:      { fontSize: 12, textAlign: 'center' },
});
