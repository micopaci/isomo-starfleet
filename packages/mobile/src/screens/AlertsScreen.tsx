/**
 * AlertsScreen — site-change events and stale-device alerts.
 *
 * Features:
 *  • Two tabs: "Changes" (site location events) and "Stale" (devices unseen)
 *  • Admins can acknowledge change alerts
 *  • Pull-to-refresh, empty states, loading skeletons
 *  • Color-coded by alert type
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, RefreshControl,
  StyleSheet, TouchableOpacity, useColorScheme,
} from 'react-native';
import { getApi, getToken, decodeJwtPayload } from '../store/auth';
import { light, dark, Colors } from '../theme/colors';
import { AlertRow } from '../components/AlertRow';
import { Skeleton } from '../components/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SiteChange {
  id:              number;
  site_id:         number;
  site_name:       string;
  change_type:     'location' | 'stale';
  description:     string;
  detected_at:     string;
  acknowledged_at: string | null;
}

interface StaleDevice {
  device_id:  number;
  site_id:    number;
  hostname:   string | null;
  site_name:  string | null;
  stale_min:  number;
  last_seen:  string | null;
}

type TabKey = 'changes' | 'stale';

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  colors?:              Colors;
  role?:                string;
  onAlertCountChange?:  (n: number) => void;
}

export function AlertsScreen({ colors, role, onAlertCountChange }: Props) {
  const scheme = useColorScheme();
  const C: Colors = colors ?? (scheme === 'dark' ? dark : light);

  const token      = getToken();
  const tokenRole  = token ? (decodeJwtPayload(token) as any)?.role : null;
  const isAdmin    = (role ?? tokenRole) === 'admin';

  const [tab, setTab] = useState<TabKey>('changes');

  // Changes tab
  const [changes,      setChanges]      = useState<SiteChange[]>([]);
  const [changesLoad,  setChangesLoad]  = useState(true);
  const [changesError, setChangesError] = useState('');
  const [ackingId,     setAckingId]     = useState<number | null>(null);

  // Stale tab
  const [stale,      setStale]      = useState<StaleDevice[]>([]);
  const [staleLoad,  setStaleLoad]  = useState(true);
  const [staleError, setStaleError] = useState('');

  async function fetchChanges() {
    setChangesLoad(true); setChangesError('');
    try {
      const api = getApi();
      if (!api) throw new Error('Not connected');
      const data = await (api as any).get('/site-changes').catch(() => []);
      setChanges(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setChangesError(e?.message ?? 'Failed to load alerts');
    } finally {
      setChangesLoad(false);
    }
  }

  async function fetchStale() {
    setStaleLoad(true); setStaleError('');
    try {
      const api = getApi();
      if (!api) throw new Error('Not connected');
      const data = await (api as any).getDevices('stale').catch(() => []);
      setStale(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setStaleError(e?.message ?? 'Failed to load stale devices');
    } finally {
      setStaleLoad(false);
    }
  }

  useEffect(() => {
    fetchChanges();
    fetchStale();
  }, []);

  // Notify parent of unack count for badge
  useEffect(() => {
    const unack = changes.filter(c => !c.acknowledged_at).length;
    onAlertCountChange?.(unack);
  }, [changes]);

  async function handleAck(id: number) {
    const api = getApi();
    if (!api) return;
    setAckingId(id);
    try {
      await (api as any).post(`/site-changes/${id}/acknowledge`).catch(() => null);
      setChanges(prev =>
        prev.map(c => c.id === id ? { ...c, acknowledged_at: new Date().toISOString() } : c),
      );
    } finally {
      setAckingId(null);
    }
  }

  function timeAgo(dateStr: string): string {
    const mins = Math.round((Date.now() - new Date(dateStr).getTime()) / 60_000);
    if (mins < 1)    return 'just now';
    if (mins < 60)   return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  }

  const unackCount = useMemo(
    () => changes.filter(c => !c.acknowledged_at).length,
    [changes],
  );

  const renderChange = useCallback(({ item: c }: { item: SiteChange }) => (
    <AlertRow
      type={c.change_type}
      siteName={c.site_name}
      description={c.description}
      timeAgo={timeAgo(c.detected_at)}
      acknowledged={!!c.acknowledged_at}
      canAck={isAdmin}
      acking={ackingId === c.id}
      onAck={() => handleAck(c.id)}
      colors={C}
    />
  ), [C, isAdmin, ackingId]);

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: C.surface, borderBottomColor: C.rule }]}>
        {([
          { key: 'changes', label: 'Site Changes', badge: unackCount },
          { key: 'stale',   label: 'Stale Devices', badge: stale.length },
        ] as Array<{ key: TabKey; label: string; badge: number }>).map(t => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[
                styles.tabBtn,
                active && [styles.tabBtnActive, { borderBottomColor: C.accent }],
              ]}
            >
              <Text style={[styles.tabText, { color: active ? C.accent : C.muted }]}>
                {t.label}
              </Text>
              {t.badge > 0 && (
                <View style={[styles.tabBadge, { backgroundColor: t.key === 'changes' ? C.bad : C.warn }]}>
                  <Text style={styles.tabBadgeText}>{t.badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Changes tab */}
      {tab === 'changes' && (
        changesLoad && changes.length === 0 ? (
          <View style={{ padding: 16 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={80} radius={10} style={{ marginBottom: 10 }} />
            ))}
          </View>
        ) : (
          <FlatList
            data={changes}
            keyExtractor={c => String(c.id)}
            renderItem={renderChange}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={changesLoad}
                onRefresh={fetchChanges}
                tintColor={C.accent}
                colors={[C.accent]}
              />
            }
            ListHeaderComponent={
              unackCount > 0 ? (
                <View style={[styles.summaryBanner, { backgroundColor: C.badSoft, borderColor: C.bad }]}>
                  <Text style={[styles.summaryText, { color: C.bad }]}>
                    {unackCount} unacknowledged alert{unackCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              ) : changes.length > 0 ? (
                <View style={[styles.summaryBanner, { backgroundColor: C.okSoft, borderColor: C.ok }]}>
                  <Text style={[styles.summaryText, { color: C.ok }]}>All alerts acknowledged ✓</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>🎉</Text>
                <Text style={[styles.emptyText, { color: C.ink3 }]}>No site change alerts</Text>
                <Text style={[styles.emptySub, { color: C.muted }]}>
                  {changesError || 'Pull down to refresh'}
                </Text>
              </View>
            }
          />
        )
      )}

      {/* Stale devices tab */}
      {tab === 'stale' && (
        staleLoad && stale.length === 0 ? (
          <View style={{ padding: 16 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={72} radius={10} style={{ marginBottom: 10 }} />
            ))}
          </View>
        ) : (
          <FlatList
            data={stale}
            keyExtractor={d => String(d.device_id)}
            renderItem={({ item: d }) => {
              const mins = d.stale_min ?? (d.last_seen
                ? Math.round((Date.now() - new Date(d.last_seen).getTime()) / 60_000)
                : null);
              return (
                <View style={[styles.staleRow, { backgroundColor: C.surface, borderColor: C.rule }]}>
                  <View style={[styles.warnDot, { backgroundColor: C.warn }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.staleName, { color: C.ink }]} numberOfLines={1}>
                      {d.hostname ?? 'Unknown device'}
                    </Text>
                    <Text style={[styles.staleSite, { color: C.ink3 }]}>
                      {d.site_name ?? `Site ${d.site_id}`}
                    </Text>
                  </View>
                  <View style={[styles.staleChip, { backgroundColor: C.warnSoft }]}>
                    <Text style={[styles.staleChipText, { color: C.warn }]}>
                      {mins != null ? `${mins}m` : '?'}
                    </Text>
                  </View>
                </View>
              );
            }}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={staleLoad}
                onRefresh={fetchStale}
                tintColor={C.accent}
                colors={[C.accent]}
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>✅</Text>
                <Text style={[styles.emptyText, { color: C.ink3 }]}>No stale devices</Text>
                <Text style={[styles.emptySub, { color: C.muted }]}>
                  {staleError || 'All computers checking in on time'}
                </Text>
              </View>
            }
          />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:          { flex: 1 },
  tabBar:          { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                     gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive:    {},
  tabText:         { fontSize: 13, fontWeight: '600' },
  tabBadge:        { borderRadius: 99, minWidth: 18, height: 18, alignItems: 'center',
                     justifyContent: 'center', paddingHorizontal: 5 },
  tabBadgeText:    { color: '#fff', fontSize: 10, fontWeight: '700' },
  list:            { padding: 12, paddingBottom: 24 },
  summaryBanner:   { borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 8 },
  summaryText:     { fontSize: 13, fontWeight: '500', textAlign: 'center' },
  staleRow:        { flexDirection: 'row', alignItems: 'center', borderRadius: 10,
                     borderWidth: 1, padding: 12, marginBottom: 8, gap: 10 },
  warnDot:         { width: 8, height: 8, borderRadius: 99, flexShrink: 0 },
  staleName:       { fontSize: 13, fontWeight: '600' },
  staleSite:       { fontSize: 12, marginTop: 2 },
  staleChip:       { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  staleChipText:   { fontSize: 12, fontWeight: '700' },
  empty:           { alignItems: 'center', marginTop: 60, gap: 6 },
  emptyIcon:       { fontSize: 36 },
  emptyText:       { fontSize: 15, fontWeight: '500' },
  emptySub:        { fontSize: 13 },
});
