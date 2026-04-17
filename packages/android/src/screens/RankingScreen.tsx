import React from 'react';
import {
  View, Text, FlatList, StyleSheet, useColorScheme, ActivityIndicator,
} from 'react-native';
import { useFleetSummary, Site } from '@starfleet/shared';
import { light, dark, Colors, latencyColor } from '../theme/colors';

export function RankingScreen() {
  const scheme = useColorScheme();
  const colors: Colors = scheme === 'dark' ? dark : light;

  const { sites, loading } = useFleetSummary();

  // Sort by average latency ascending (lower = better)
  const sorted = [...sites].sort((a, b) => {
    const la = a.latest_signal?.pop_latency_ms ?? Infinity;
    const lb = b.latest_signal?.pop_latency_ms ?? Infinity;
    return la - lb;
  });

  if (loading && sites.length === 0) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.header, { color: colors.text2 }]}>Sorted by PoP latency</Text>
      <FlatList
        data={sorted}
        keyExtractor={i => String(i.id)}
        renderItem={({ item, index }) => (
          <RankRow item={item} rank={index + 1} colors={colors} />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.text2 }]}>No data yet</Text>
        }
      />
    </View>
  );
}

function RankRow({ item, rank, colors }: { item: Site; rank: number; colors: Colors }) {
  const latency  = item.latest_signal?.pop_latency_ms;
  const dotColor = latencyColor(latency);
  const latStr   = latency != null ? `${Math.round(latency)} ms` : '— ms';

  return (
    <View style={[styles.row, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <Text style={[styles.rank, { color: colors.text2 }]}>#{rank}</Text>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
      <Text style={[styles.latency, { color: colors.text }]}>{latStr}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  header:  { fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  list:    { paddingHorizontal: 16, paddingBottom: 16 },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:   { textAlign: 'center', marginTop: 40 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8,
             borderWidth: 1, padding: 12, marginBottom: 8 },
  rank:    { width: 28, fontSize: 13 },
  dot:     { width: 8, height: 8, borderRadius: 99 },
  name:    { flex: 1, fontSize: 13 },
  latency: { fontWeight: '600', fontSize: 13 },
});
