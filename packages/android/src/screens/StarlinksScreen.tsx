/**
 * StarlinksScreen — browse every Starlink dish in the fleet.
 *
 * Features:
 *  • Live data via /api/starlinks (polled on mount + pull-to-refresh)
 *  • Search by site name or dish serial
 *  • Filter chips: All / Online / Degraded / Offline
 *  • Sort by score, download, upload, latency
 *  • DishRow card with score accent bar
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  RefreshControl, StyleSheet, ScrollView, ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { getApi } from '../store/auth';
import { light, dark, Colors, scoreColor, latencyColor } from '../theme/colors';
import { DishRow } from '../components/DishRow';
import { Skeleton } from '../components/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dish {
  id:            number;
  site_id:       number | null;
  site_name:     string | null;
  serial:        string;
  score:         number | null;
  download_mbps: number | null;
  upload_mbps:   number | null;
  pop_latency_ms:number | null;
  status:        'online' | 'degraded' | 'offline';
  last_seen:     string | null;
}

type FilterKey = 'all' | 'online' | 'degraded' | 'offline';
type SortKey   = 'score' | 'download' | 'upload' | 'latency';

const FILTER_LABELS: Record<FilterKey, string> = {
  all:      'All',
  online:   '✅ Online',
  degraded: '⚠️ Degraded',
  offline:  '🔴 Offline',
};

const SORT_LABELS: Record<SortKey, string> = {
  score:    'Score',
  download: 'Down',
  upload:   'Up',
  latency:  'Latency',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function StarlinksScreen() {
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const [dishes,   setDishes]   = useState<Dish[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [query,    setQuery]    = useState('');
  const [filter,   setFilter]   = useState<FilterKey>('all');
  const [sort,     setSort]     = useState<SortKey>('score');

  async function fetchDishes() {
    setLoading(true);
    setError('');
    try {
      const api = getApi();
      if (!api) throw new Error('Not connected');
      // Fetch from /api/starlinks (list of all dishes with live metrics)
      const data = await (api as any).get('/starlinks').catch(() => null);
      if (Array.isArray(data)) {
        setDishes(data);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDishes(); }, []);

  // Counts per status for filter pills
  const counts = useMemo(() => ({
    all:      dishes.length,
    online:   dishes.filter(d => d.status === 'online').length,
    degraded: dishes.filter(d => d.status === 'degraded').length,
    offline:  dishes.filter(d => d.status === 'offline').length,
  }), [dishes]);

  const filtered = useMemo(() => {
    let list = dishes;

    // Status filter
    if (filter !== 'all') list = list.filter(d => d.status === filter);

    // Search
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(d =>
        (d.site_name ?? '').toLowerCase().includes(q) ||
        d.serial.toLowerCase().includes(q),
      );
    }

    // Sort
    return [...list].sort((a, b) => {
      if (sort === 'score')    return (b.score ?? -1) - (a.score ?? -1);
      if (sort === 'download') return (b.download_mbps ?? -1) - (a.download_mbps ?? -1);
      if (sort === 'upload')   return (b.upload_mbps ?? -1) - (a.upload_mbps ?? -1);
      if (sort === 'latency') {
        // Lower latency is better — null sinks to bottom
        const la = a.pop_latency_ms ?? Infinity;
        const lb = b.pop_latency_ms ?? Infinity;
        return la - lb;
      }
      return 0;
    });
  }, [dishes, filter, query, sort]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: C.surface, borderBottomColor: C.rule }]}>
        <View style={[styles.searchInput, { backgroundColor: C.surface2, borderColor: C.rule }]}>
          <Text style={[styles.searchIcon, { color: C.muted }]}>🔍</Text>
          <TextInput
            style={[styles.searchText, { color: C.ink }]}
            placeholder="Site name or serial…"
            placeholderTextColor={C.muted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Text style={[{ color: C.muted, fontSize: 13 }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.filterRow, { borderBottomColor: C.rule }]}
      >
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map(k => {
          const active = filter === k;
          return (
            <TouchableOpacity
              key={k}
              onPress={() => setFilter(k)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? C.accent : C.surface2,
                  borderColor:     active ? C.accent : C.rule,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: active ? '#fff' : C.ink3 }]}>
                {FILTER_LABELS[k]} {counts[k] > 0 ? `(${counts[k]})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Sort chips */}
      <View style={[styles.sortBar, { borderBottomColor: C.rule }]}>
        <Text style={[styles.sortLabel, { color: C.muted }]}>Sort:</Text>
        {(Object.keys(SORT_LABELS) as SortKey[]).map(k => {
          const active = sort === k;
          return (
            <TouchableOpacity
              key={k}
              onPress={() => setSort(k)}
              style={[
                styles.sortChip,
                {
                  backgroundColor: active ? C.accentSoft : 'transparent',
                  borderColor:     active ? C.accent : C.rule,
                },
              ]}
            >
              <Text style={[styles.sortText, { color: active ? C.accentInk : C.ink3 }]}>
                {SORT_LABELS[k]}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Text style={[styles.countLabel, { color: C.muted }]}>
          {filtered.length} dish{filtered.length !== 1 ? 'es' : ''}
        </Text>
      </View>

      {/* Content */}
      {loading && dishes.length === 0 ? (
        <View style={styles.skeletons}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={80} radius={10} style={{ marginBottom: 10 }} />
          ))}
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: C.bad }]}>{error}</Text>
          <TouchableOpacity
            onPress={fetchDishes}
            style={[styles.retryBtn, { borderColor: C.accent }]}
          >
            <Text style={{ color: C.accent, fontSize: 13 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={d => String(d.id)}
          renderItem={({ item: d }) => (
            <DishRow
              siteName={d.site_name ?? '—'}
              serial={d.serial}
              score={d.score}
              downloadMbps={d.download_mbps}
              uploadMbps={d.upload_mbps}
              status={d.status}
              colors={C}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchDishes}
              tintColor={C.accent}
              colors={[C.accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: C.ink3 }]}>
                {query || filter !== 'all' ? 'No dishes match filters' : 'No dishes found'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:      { flex: 1 },
  searchWrap:  { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  searchInput: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1,
                 paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  searchIcon:  { fontSize: 14 },
  searchText:  { flex: 1, fontSize: 14, padding: 0 },
  filterRow:   { paddingHorizontal: 12, paddingVertical: 8, gap: 6,
                 borderBottomWidth: StyleSheet.hairlineWidth },
  filterChip:  { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  filterText:  { fontSize: 12, fontWeight: '600' },
  sortBar:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
                 paddingVertical: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  sortLabel:   { fontSize: 11, marginRight: 2 },
  sortChip:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  sortText:    { fontSize: 11, fontWeight: '600' },
  countLabel:  { marginLeft: 'auto', fontSize: 11 },
  skeletons:   { padding: 16 },
  list:        { padding: 12, paddingBottom: 24 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 40 },
  errorText:   { fontSize: 14, textAlign: 'center' },
  emptyText:   { fontSize: 14 },
  retryBtn:    { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
});
