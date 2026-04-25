import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, useColorScheme,
} from 'react-native';
import {
  useSite, useSignalHistory, predictCause, computeSignalScore,
} from '@starfleet/shared';
import { ScorePill }     from '../components/ScorePill';
import { MetricTile }    from '../components/MetricTile';
import { SparkLine }     from '../components/SparkLine';
import { StatusChip }    from '../components/StatusChip';
import { OfflineBanner } from '../components/OfflineBanner';
import { SiteDetailProps } from '../navigation/types';
import { saveSite, loadSite, ageLabel } from '../store/cache';
import { getApi, getToken, decodeJwtPayload } from '../store/auth';
import { light, dark, Colors } from '../theme/colors';

export function SiteDetailScreen({ route, navigation }: SiteDetailProps) {
  const { siteId } = route.params;
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const { site, loading, error, refresh } = useSite(siteId);
  const { scores } = useSignalHistory(siteId);

  const [offline,     setOffline]   = useState(false);
  const [cachedAge,   setCachedAge] = useState('');
  const [displaySite, setDisplay]   = useState(site);

  const token   = getToken();
  const isAdmin = token ? (decodeJwtPayload(token) as any)?.role === 'admin' : false;

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
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }
  if (error && !displaySite) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <Text style={{ color: C.bad }}>Error: {error}</Text>
        <TouchableOpacity onPress={refresh} style={[styles.retryBtn, { borderColor: C.accent }]}>
          <Text style={{ color: C.accent }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!displaySite) return null;

  const sig   = displaySite.signal;
  const scoreInput = sig
    ? {
        ping_drop_pct: sig.ping_drop_pct ?? undefined,
        obstruction_pct: sig.obstruction_pct ?? undefined,
        snr: sig.snr ?? undefined,
        pop_latency_ms: sig.pop_latency_ms ?? undefined,
      }
    : {};
  const cause = predictCause(scoreInput);

  const onlineDevices = displaySite.devices.filter(d =>
    d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 10 * 60_000,
  ).length;
  const totalDevices = displaySite.devices.length;

  const scoreVal = displaySite.score ?? (sig ? computeSignalScore(scoreInput) : null);

  // Site status derived from score
  const siteStatus: 'online' | 'degraded' | 'offline' =
    scoreVal == null ? 'offline'
    : scoreVal >= 80 ? 'online'
    : scoreVal >= 40 ? 'degraded'
    : 'offline';

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.bg }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
    >
      {offline && <OfflineBanner label={`Last updated ${cachedAge}`} />}

      {/* Hero card */}
      <View style={[styles.heroCard, { backgroundColor: C.surface, borderColor: C.rule }]}>
        <View style={styles.heroTop}>
          <ScorePill score={scoreVal ?? undefined} size="lg" />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <StatusChip status={siteStatus} colors={C} />
              {sig?.anomaly && (
                <View style={[styles.badge, { borderColor: C.warn, backgroundColor: C.warnSoft }]}>
                  <Text style={[styles.badgeText, { color: C.warn }]}>⚠ Anomaly</Text>
                </View>
              )}
            </View>
            <Text style={[styles.cause, { color: C.ink3 }]}>{cause}</Text>
            {displaySite.score_7day_avg != null && (
              <Text style={[styles.avgLabel, { color: C.muted }]}>
                7-day avg: {Math.round(displaySite.score_7day_avg)}
              </Text>
            )}
          </View>
        </View>
        {sig?.confidence === 'low' && (
          <View style={[styles.badge, { borderColor: C.muted, alignSelf: 'center', marginTop: 4 }]}>
            <Text style={{ color: C.muted, fontSize: 11 }}>Low confidence</Text>
          </View>
        )}
      </View>

      {/* 4 metric tiles */}
      <View style={styles.tilesRow}>
        <MetricTile label="SNR"
          value={sig?.snr != null ? sig.snr.toFixed(1) : null}
          unit=" dB" colors={C} />
        <MetricTile label="Ping Drop"
          value={sig?.ping_drop_pct != null ? sig.ping_drop_pct.toFixed(1) : null}
          unit="%" colors={C} />
        <MetricTile label="Obstruction"
          value={sig?.obstruction_pct != null ? sig.obstruction_pct.toFixed(1) : null}
          unit="%" colors={C} />
        <MetricTile label="Latency"
          value={sig?.pop_latency_ms != null ? Math.round(sig.pop_latency_ms) : null}
          unit=" ms" colors={C} />
      </View>

      {/* 7-day sparkline */}
      <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
        <Text style={[styles.cardTitle, { color: C.ink }]}>7-day Signal Score</Text>
        <SparkLine scores={scores} colors={C} />
      </View>

      {/* Devices */}
      <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: C.ink }]}>
            Computers — {onlineDevices}/{totalDevices} online
          </Text>
          {isAdmin && (
            <TouchableOpacity
              style={[styles.refreshBtn, { borderColor: C.accent }]}
              onPress={handleRefreshAll}
            >
              <Text style={[styles.refreshBtnText, { color: C.accent }]}>Refresh all</Text>
            </TouchableOpacity>
          )}
        </View>

        {displaySite.devices.length === 0 ? (
          <Text style={[styles.emptyText, { color: C.muted }]}>No devices registered</Text>
        ) : (
          displaySite.devices.map(d => {
            const isOnline = d.last_seen &&
              Date.now() - new Date(d.last_seen).getTime() < 10 * 60_000;
            const deviceStatus: 'online' | 'stale' | 'offline' =
              isOnline ? 'online' : d.status === 'stale' ? 'stale' : 'offline';
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.deviceRow, { borderBottomColor: C.rule }]}
                onPress={() => navigation.navigate('DeviceDetail', {
                  deviceId: d.id, deviceName: d.hostname ?? 'Unknown', siteId,
                })}
                activeOpacity={0.7}
              >
                <View style={[styles.statusDot, {
                  backgroundColor: deviceStatus === 'online' ? C.ok
                    : deviceStatus === 'stale' ? C.warn : C.muted,
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.deviceName, { color: C.ink }]} numberOfLines={1}>
                    {d.hostname ?? 'Unknown'}
                  </Text>
                  {d.role === 'agent' && (
                    <Text style={[styles.deviceRole, { color: C.accent }]}>agent</Text>
                  )}
                </View>
                <Text style={[styles.lastSeen, { color: C.muted }]}>
                  {d.last_seen ? formatAgo(new Date(d.last_seen)) : 'never'}
                </Text>
                <Text style={[styles.chevron, { color: C.muted }]}>›</Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function formatAgo(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

const styles = StyleSheet.create({
  screen:        { flex: 1 },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  heroCard:      { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  heroTop:       { flexDirection: 'row', alignItems: 'flex-start' },
  cause:         { fontSize: 13, marginBottom: 2 },
  avgLabel:      { fontSize: 11 },
  badge:         { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText:     { fontSize: 11 },
  tilesRow:      { flexDirection: 'row', marginBottom: 12, gap: 6 },
  card:          { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardHeader:    { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardTitle:     { flex: 1, fontWeight: '600', fontSize: 14 },
  refreshBtn:    { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  refreshBtnText:{ fontSize: 12 },
  deviceRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
                   borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  statusDot:     { width: 7, height: 7, borderRadius: 99, flexShrink: 0 },
  deviceName:    { fontSize: 13, fontWeight: '500' },
  deviceRole:    { fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
  lastSeen:      { fontSize: 11 },
  chevron:       { fontSize: 18, marginLeft: 4 },
  emptyText:     { fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  retryBtn:      { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
});
