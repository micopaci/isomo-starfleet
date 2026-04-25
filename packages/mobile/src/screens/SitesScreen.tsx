import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, FlatList, Text, TextInput, TouchableOpacity,
  RefreshControl, StyleSheet, useColorScheme,
} from 'react-native';
import { useFleetSummary, Site } from '@starfleet/shared';
import { SiteCard }      from '../components/SiteCard';
import { Skeleton }      from '../components/Skeleton';
import { OfflineBanner } from '../components/OfflineBanner';
import { SitesListProps } from '../navigation/types';
import { saveFleet, loadFleet, ageLabel } from '../store/cache';
import { light, dark, Colors } from '../theme/colors';

type SortKey = 'name' | 'score' | 'status';

const SORT_LABELS: Record<SortKey, string> = {
  name:   'A–Z',
  score:  'Score',
  status: 'Status',
};

export function SitesScreen({ navigation }: SitesListProps) {
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const { sites, loading, refresh } = useFleetSummary();

  const [offline,     setOffline]     = useState(false);
  const [cachedAge,   setCachedAge]   = useState('');
  const [cachedSites, setCachedSites] = useState<Site[]>([]);
  const [query,       setQuery]       = useState('');
  const [sort,        setSort]        = useState<SortKey>('score');

  // Persist live data; restore cache when offline
  useEffect(() => {
    if (sites.length > 0) {
      setOffline(false);
      saveFleet(sites);
    } else if (!loading) {
      loadFleet().then(cached => {
        if (cached) {
          setCachedSites(cached.data);
          setCachedAge(ageLabel(cached.cachedAt));
          setOffline(true);
        }
      });
    }
  }, [sites, loading]);

  const displaySites = sites.length > 0 ? sites : cachedSites;

  const filtered = useMemo(() => {
    let list = displaySites;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sort === 'name')   return a.name.localeCompare(b.name);
      if (sort === 'score') {
        const sa = a.score ?? -1;
        const sb = b.score ?? -1;
        return sb - sa;
      }
      // status: online > degraded > offline
      const statusRank = (s: Site) => {
        const sc = s.score ?? 0;
        if (sc >= 80) return 0;
        if (sc >= 40) return 1;
        return 2;
      };
      return statusRank(a) - statusRank(b);
    });
  }, [displaySites, query, sort]);

  const onPressSite = useCallback((siteId: number) => {
    navigation.navigate('SiteDetail', { siteId });
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: Site }) => (
      <SiteCard site={item} onPress={() => onPressSite(item.id)} colors={C} />
    ),
    [C, onPressSite],
  );

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>
      {offline && <OfflineBanner label={`Last updated ${cachedAge}`} />}

      {/* Search bar */}
      <View style={[styles.searchWrap, { backgroundColor: C.surface, borderBottomColor: C.rule }]}>
        <View style={[styles.searchInput, { backgroundColor: C.surface2, borderColor: C.rule }]}>
          <Text style={[styles.searchIcon, { color: C.muted }]}>🔍</Text>
          <TextInput
            style={[styles.searchText, { color: C.ink }]}
            placeholder="Search campuses…"
            placeholderTextColor={C.muted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Text style={[styles.clearBtn, { color: C.muted }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Sort chips */}
        <View style={styles.sortRow}>
          {(Object.keys(SORT_LABELS) as SortKey[]).map(k => {
            const active = sort === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setSort(k)}
                style={[
                  styles.sortChip,
                  {
                    backgroundColor: active ? C.accent : C.surface2,
                    borderColor:     active ? C.accent : C.rule,
                  },
                ]}
              >
                <Text style={[styles.sortChipText, { color: active ? '#fff' : C.ink3 }]}>
                  {SORT_LABELS[k]}
                </Text>
              </TouchableOpacity>
            );
          })}
          <Text style={[styles.countLabel, { color: C.muted }]}>
            {filtered.length} of {displaySites.length}
          </Text>
        </View>
      </View>

      {/* List */}
      {loading && displaySites.length === 0 ? (
        <View style={styles.skeletons}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={72} radius={10} style={{ marginBottom: 10 }} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => String(i.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.accent} colors={[C.accent]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: C.ink3 }]}>
                {query ? `No campuses matching "${query}"` : 'No sites found'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1 },
  searchWrap:   { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  searchInput:  { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1,
                  paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  searchIcon:   { fontSize: 14 },
  searchText:   { flex: 1, fontSize: 14, padding: 0 },
  clearBtn:     { fontSize: 13, paddingLeft: 4 },
  sortRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  sortChip:     { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, borderWidth: 1 },
  sortChipText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  countLabel:   { marginLeft: 'auto', fontSize: 11 },
  skeletons:    { padding: 16 },
  list:         { padding: 12, paddingBottom: 24 },
  emptyWrap:    { alignItems: 'center', marginTop: 60 },
  emptyText:    { fontSize: 14 },
});
