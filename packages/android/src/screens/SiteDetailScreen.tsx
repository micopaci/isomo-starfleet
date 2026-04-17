import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, useColorScheme,
} from 'react-native';
import {
  useSite, useSignalHistory, predictCause, formatLatency,
} from '@starfleet/shared';
import { ScorePill }     from '../components/ScorePill';
import { MetricTile }    from '../components/MetricTile';
import { SparkLine }     from '../components/SparkLine';
import { OfflineBanner } from '../components/OfflineBanner';
import { SiteDetailProps } from '../navigation/types';
import { saveSite, loadSite, ageLabel } from '../store/cache';
import { getApi } from '../store/auth';
import { light, dark, Colors } from '../theme/colors';

export function SiteDetailScreen({ route, navigation }: SiteDetailProps) {
  const { siteId } = route.params;
  const scheme = useColorScheme();
  const colors: Colors = scheme === 'dark' ? dark : light;

  const { site, loading, error, refresh } = useSite(siteId);
  const { scores } = useSignalHistory(siteId);

  const [offline,   setOffline]  = useState(false);
  const [cachedAge, setCachedAge]= useState('');
  const [displaySite, setDisplay]= useState(site);

  useEffect(() => {
    if (site) {
      setOffline(false);
      setDisplay(site);
      saveSite(siteId, site);
    } else if (!loading) {
      loadSite(siteId).then(cached => {
        if (cached) {
          setDisplay(cached.data);
          setCachedAge(ageLabel(cached.cachedAt));
          setOffline(true);
        }
      });
    }
  }, [site, loading, siteId]);

  // Update header title
  useEffect(() => {
    if (displaySite) {
      navigation.setOptions({ title: displaySite.name });
    }
  }, [displaySite, navigation]);

  async function handleRefreshAll() {
    if (!displaySite) return;
    const api = getApi();
    if (!api) return;
    for (const d of displaySite.devices) {
      try { await api.triggerScript(d.id, 'location_refresh'); } catch {}
    }
    refresh();
  }

  if (loading && !displaySite) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  if (error && !displaySite) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#ef4444' }}>Error: {error}</Text>
        <TouchableOpacity onPress={refresh} style={[styles.btn, { borderColor: colors.accent }]}>
          <Text style={{ color: colors.accent }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!displaySite) return null;

  const sig   = displaySite.latest_signal;
  const cause = predictCause(sig ?? null);

  const onlineLaptops  = displaySite.devices.filter(d => d.last_seen &&
    Date.now() - new Date(d.last_seen).getTime() < 10 * 60_000).length;
  const totalLaptops   = displaySite.devices.length;

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]}>
      {offline && <OfflineBanner label={`Last updated ${cachedAge}`} />}

      {/* Score hero */}
      <View style={[styles.heroCard, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
        <ScorePill score={sig?.score} size="lg" />
        <Text style={[styles.cause, { color: colors.text2 }]}>{cause}</Text>
        {sig?.confidence === 'low' && (
          <View style={[styles.badge, { borderColor: '#f59e0b' }]}>
            <Text style={{ color: '#f59e0b', fontSize: 11 }}>Low confidence</Text>
          </View>
        )}
      </View>

      {/* 4 metric tiles */}
      <View style={styles.tilesRow}>
        <MetricTile label="SNR"         value={sig?.snr_db != null ? sig.snr_db.toFixed(1) : null}       unit=" dB" colors={colors} />
        <MetricTile label="Ping Drop"   value={sig?.ping_drop_pct != null ? sig.ping_drop_pct.toFixed(1) : null} unit="%"  colors={colors} />
        <MetricTile label="Obstruction" value={sig?.obstruction_pct != null ? sig.obstruction_pct.toFixed(1) : null} unit="%" colors={colors} />
        <MetricTile label="PoP Latency" value={sig?.pop_latency_ms != null ? Math.round(sig.pop_latency_ms) : null} unit=" ms" colors={colors} />
      </View>

      {/* 7-day sparkline */}
      <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>7-day Signal Score</Text>
        <SparkLine scores={scores} colors={colors} />
      </View>

      {/* Laptop summary + list */}
      <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Laptops — {onlineLaptops}/{totalLaptops} online
          </Text>
          <TouchableOpacity
            style={[styles.refreshBtn, { borderColor: colors.accent }]}
            onPress={handleRefreshAll}
          >
            <Text style={{ color: colors.accent, fontSize: 12 }}>Refresh all</Text>
          </TouchableOpacity>
        </View>

        {displaySite.devices.map(d => {
          const isOnline = d.last_seen &&
            Date.now() - new Date(d.last_seen).getTime() < 10 * 60_000;
          return (
            <TouchableOpacity
              key={d.id}
              style={[styles.laptopRow, { borderBottomColor: colors.border }]}
              onPress={() => navigation.navigate('LaptopDetail', {
                deviceId: d.id, deviceName: d.hostname ?? 'Unknown', siteId,
              })}
            >
              <View style={[styles.statusDot, { backgroundColor: isOnline ? '#22c55e' : '#94a3b8' }]} />
              <Text style={[styles.laptopName, { color: colors.text }]} numberOfLines={1}>
                {d.hostname ?? 'Unknown'}
              </Text>
              <Text style={[styles.lastSeen, { color: colors.text2 }]}>
                {d.last_seen ? formatAgo(new Date(d.last_seen)) : 'never'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

function formatAgo(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

const styles = StyleSheet.create({
  screen:     { flex: 1, padding: 16 },
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  heroCard:   { borderRadius: 12, borderWidth: 1, padding: 20, alignItems: 'center', gap: 8, marginBottom: 12 },
  cause:      { fontSize: 13 },
  badge:      { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  tilesRow:   { flexDirection: 'row', marginBottom: 12 },
  card:       { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardTitle:  { flex: 1, fontWeight: '600', fontSize: 14 },
  refreshBtn: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  laptopRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                borderBottomWidth: 1 },
  statusDot:  { width: 7, height: 7, borderRadius: 99, marginRight: 8, flexShrink: 0 },
  laptopName: { flex: 1, fontSize: 13 },
  lastSeen:   { fontSize: 12 },
  btn:        { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
});
