import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, RefreshControl, StyleSheet, useColorScheme,
} from 'react-native';
import { useFleetSummary } from '@starfleet/shared';
import { light, dark, Colors } from '../theme/colors';
import { StatCard }      from '../components/StatCard';
import { SiteCard }      from '../components/SiteCard';
import { Skeleton }      from '../components/Skeleton';
import { OfflineBanner } from '../components/OfflineBanner';
import { getApi }        from '../store/auth';
import { saveFleet, loadFleet, ageLabel } from '../store/cache';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function OverviewScreen() {
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const { sites, summary, loading, error, refresh } = useFleetSummary();

  const [spaceKp,       setSpaceKp]       = useState<number | null>(null);
  const [spaceCondition,setSpaceCondition]= useState('');
  const [offline,       setOffline]       = useState(false);
  const [cachedAge,     setCachedAge]     = useState('');

  // Persist / restore cache
  useEffect(() => {
    if (sites.length > 0) { setOffline(false); saveFleet(sites); return; }
    if (!loading) {
      loadFleet().then(c => {
        if (c) { setCachedAge(ageLabel(c.cachedAt)); setOffline(true); }
      });
    }
  }, [sites, loading]);

  // Space weather
  useEffect(() => {
    getApi()?.get<Array<{ k_index: number | null; condition_label: string | null }>>('/api/intel/space-weather').then((rows) => {
      const latest = rows?.[0];
      setSpaceKp(latest?.k_index ?? null);
      setSpaceCondition(latest?.condition_label ?? '');
    }).catch(() => {});
  }, []);

  const sortedSites = [...sites].sort((a, b) =>
    Number((b as any).score ?? 0) - Number((a as any).score ?? 0)
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.accent} />}
    >
      {offline && <OfflineBanner label={`Last updated ${cachedAge}`} />}

      {/* Header */}
      <View style={s.header}>
        <Text style={[s.greeting, { color: C.ink }]}>{greeting()}</Text>
        <Text style={[s.date, { color: C.ink3 }]}>
          {new Date().toLocaleDateString('en-RW', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
      </View>

      {/* Fleet stats */}
      {loading && !summary ? (
        <View style={s.skeletonRow}>
          <Skeleton height={80} style={{ flex: 1 }} />
          <Skeleton height={80} style={{ flex: 1 }} />
          <Skeleton height={80} style={{ flex: 1 }} />
        </View>
      ) : summary ? (
        <>
          <View style={s.statsRow}>
            <StatCard label="Online" value={summary.online_sites} icon="✅" color={C.ok} colors={C} />
            <StatCard label="Degraded" value={summary.degraded_sites} icon="⚠️" color={C.warn} colors={C} />
            <StatCard label="Offline" value={summary.dark_sites} icon="🔴" color={C.bad} colors={C} />
          </View>
          <View style={[s.statsRow, { marginTop: 8 }]}>
            <StatCard label="Computers" value={summary.online_laptops} icon="💻" color={C.accent} colors={C}
              sub={`of ${summary.total_laptops} total`} />
            <StatCard label="Sites" value={summary.total_sites} icon="🏫" color={C.ink2} colors={C} />
            {spaceKp != null && (
              <StatCard label="Kp Index" value={spaceKp.toFixed(1)} icon="🌌"
                color={spaceKp < 3 ? C.ok : spaceKp < 5 ? C.warn : C.bad} colors={C}
                sub={spaceCondition || undefined} />
            )}
          </View>
        </>
      ) : null}

      {/* Error */}
      {!!error && !summary && (
        <View style={[s.errorBox, { backgroundColor: C.badSoft, borderColor: C.bad }]}>
          <Text style={[s.errorText, { color: C.bad }]}>⚠ {error}</Text>
        </View>
      )}

      {/* Section header */}
      <Text style={[s.sectionTitle, { color: C.ink2 }]}>All Campuses</Text>

      {/* Site cards */}
      {loading && sites.length === 0
        ? Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={72} radius={10} style={{ marginBottom: 10 }} />
          ))
        : sortedSites.map(site => (
            <SiteCard key={site.id} site={site} colors={C} onPress={() => {}} />
          ))
      }
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content:      { padding: 16, paddingBottom: 32 },
  header:       { marginBottom: 16 },
  greeting:     { fontSize: 22, fontWeight: '700' },
  date:         { fontSize: 13, marginTop: 2 },
  skeletonRow:  { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statsRow:     { flexDirection: 'row', gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 10 },
  errorBox:     { borderRadius: 8, borderWidth: 1, padding: 12, marginBottom: 12 },
  errorText:    { fontSize: 13 },
});
