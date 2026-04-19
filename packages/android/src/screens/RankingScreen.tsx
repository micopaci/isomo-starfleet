import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, useColorScheme,
  ActivityIndicator, TouchableOpacity, ScrollView,
} from 'react-native';
import { useFleetSummary, Site } from '@starfleet/shared';
import { light, dark, Colors, latencyColor, scoreColor } from '../theme/colors';

// ── Available ranking metrics ───────────────────────────────────────────────
type MetricKey =
  | 'score'
  | 'latency'
  | 'download'
  | 'upload'
  | 'data'
  | 'uptime'
  | 'ping_drop';

interface MetricDef {
  key:       MetricKey;
  label:     string;
  shortLabel:string;
  /** Extract the numeric value to sort by. */
  extract:   (s: Site) => number | null;
  /** `asc` means lower = better (latency, ping_drop); else higher = better. */
  direction: 'asc' | 'desc';
  /** How to format the value for display. */
  format:    (v: number | null) => string;
  /** Colour logic: pass value, return hex. */
  colorFor:  (v: number | null) => string;
}

const METRICS: MetricDef[] = [
  {
    key: 'score',
    label: 'Signal score',
    shortLabel: 'SCORE',
    direction: 'desc',
    extract:  s => (s as any).score ?? s.latest_signal?.score ?? null,
    format:   v => v == null ? '—' : String(Math.round(v)),
    colorFor: v => v == null ? '#94a3b8' : scoreColor(v),
  },
  {
    key: 'latency',
    label: 'PoP latency',
    shortLabel: 'LATENCY',
    direction: 'asc',
    extract:  s => s.latest_signal?.pop_latency_ms ?? null,
    format:   v => v == null ? '— ms' : `${Math.round(v)} ms`,
    colorFor: v => latencyColor(v),
  },
  {
    key: 'download',
    label: 'Download',
    shortLabel: 'DOWN',
    direction: 'desc',
    extract:  s => (s as any).download_mbps ?? null,
    format:   v => v == null ? '—'  : `${v.toFixed(1)} Mbps`,
    colorFor: v => v == null ? '#94a3b8' : v >= 100 ? '#22c55e' : v >= 25 ? '#f59e0b' : '#ef4444',
  },
  {
    key: 'upload',
    label: 'Upload',
    shortLabel: 'UP',
    direction: 'desc',
    extract:  s => (s as any).upload_mbps ?? null,
    format:   v => v == null ? '—'  : `${v.toFixed(1)} Mbps`,
    colorFor: v => v == null ? '#94a3b8' : v >= 15 ? '#22c55e' : v >= 5 ? '#f59e0b' : '#ef4444',
  },
  {
    key: 'data',
    label: 'Data today',
    shortLabel: 'DATA',
    direction: 'desc',
    extract:  s => (s as any).data_mb_today ?? null,
    format:   v => {
      if (v == null) return '—';
      if (v >= 1024) return `${(v / 1024).toFixed(2)} GB`;
      return `${Math.round(v)} MB`;
    },
    colorFor: () => '#10b981',
  },
  {
    key: 'uptime',
    label: 'Uptime',
    shortLabel: 'UPTIME',
    direction: 'desc',
    extract:  s => (s as any).uptime_pct ?? null,
    format:   v => v == null ? '—' : `${v.toFixed(1)} %`,
    colorFor: v => v == null ? '#94a3b8' : v >= 98 ? '#22c55e' : v >= 90 ? '#f59e0b' : '#ef4444',
  },
  {
    key: 'ping_drop',
    label: 'Ping drop',
    shortLabel: 'DROP',
    direction: 'asc',
    extract:  s => s.latest_signal?.ping_drop_pct ?? null,
    format:   v => v == null ? '—' : `${v.toFixed(1)} %`,
    colorFor: v => v == null ? '#94a3b8' : v <= 0.5 ? '#22c55e' : v <= 2 ? '#f59e0b' : '#ef4444',
  },
];

export function RankingScreen() {
  const scheme = useColorScheme();
  const colors: Colors = scheme === 'dark' ? dark : light;

  const [metricKey, setMetricKey] = useState<MetricKey>('score');
  const metric = METRICS.find(m => m.key === metricKey)!;

  const { sites, loading } = useFleetSummary();

  const sorted = useMemo(() => {
    const mult = metric.direction === 'asc' ? 1 : -1;
    return [...sites].sort((a, b) => {
      const va = metric.extract(a);
      const vb = metric.extract(b);
      // Nulls sink to the bottom regardless of direction
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * mult;
    });
  }, [sites, metric]);

  if (loading && sites.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Metric selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {METRICS.map(m => {
          const active = m.key === metricKey;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => setMetricKey(m.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.accent : colors.bg2,
                  borderColor:     active ? colors.accent : colors.border,
                },
              ]}
            >
              <Text style={[
                styles.chipText,
                { color: active ? '#fff' : colors.text2 },
              ]}>
                {m.shortLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={[styles.header, { color: colors.text2 }]}>
        {metric.label} · {metric.direction === 'asc' ? 'lower is better' : 'higher is better'}
      </Text>

      <FlatList
        data={sorted}
        keyExtractor={i => String(i.id)}
        renderItem={({ item, index }) => (
          <RankRow
            item={item}
            rank={index + 1}
            metric={metric}
            colors={colors}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.text2 }]}>No data yet</Text>
        }
      />
    </View>
  );
}

function RankRow({
  item, rank, metric, colors,
}: {
  item: Site; rank: number; metric: MetricDef; colors: Colors;
}) {
  const v          = metric.extract(item);
  const display    = metric.format(v);
  const dotColor   = metric.colorFor(v);

  return (
    <View style={[styles.row, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <Text style={[styles.rank, { color: colors.text2 }]}>#{rank}</Text>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
      <Text style={[styles.value, { color: colors.text }]}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  header:  { fontSize: 11, textAlign: 'center', paddingVertical: 6, letterSpacing: 0.5 },
  chips:   { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  chip:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, borderWidth: 1, marginRight: 6 },
  chipText:{ fontSize: 11, fontWeight: '600', letterSpacing: 0.6 },
  list:    { paddingHorizontal: 16, paddingBottom: 16 },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:   { textAlign: 'center', marginTop: 40 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8,
             borderWidth: 1, padding: 12, marginBottom: 8 },
  rank:    { width: 28, fontSize: 13 },
  dot:     { width: 8, height: 8, borderRadius: 99 },
  name:    { flex: 1, fontSize: 13 },
  value:   { fontWeight: '600', fontSize: 13 },
});
