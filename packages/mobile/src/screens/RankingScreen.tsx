import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, useColorScheme,
  ActivityIndicator, TouchableOpacity, ScrollView,
} from 'react-native';
import { useFleetSummary, Site } from '@starfleet/shared';
import { light, dark, Colors, latencyColor, scoreColor } from '../theme/colors';

// ── Metric definitions ───────────────────────────────────────────────────────

type MetricKey =
  | 'score'
  | 'latency'
  | 'download'
  | 'upload'
  | 'data'
  | 'uptime'
  | 'ping_drop';

interface MetricDef {
  key:        MetricKey;
  label:      string;
  shortLabel: string;
  direction:  'asc' | 'desc';
  extract:    (s: Site) => number | null;
  format:     (v: number | null) => string;
  colorFor:   (v: number | null, C: Colors) => string;
}

const METRICS: MetricDef[] = [
  {
    key: 'score',
    label: 'Signal score',
    shortLabel: 'SCORE',
    direction: 'desc',
    extract:  s => s.score ?? null,
    format:   v => v == null ? '—' : String(Math.round(v)),
    colorFor: (v, C) => v == null ? C.muted : scoreColor(v, C),
  },
  {
    key: 'latency',
    label: 'PoP latency',
    shortLabel: 'LATENCY',
    direction: 'asc',
    extract:  s => s.signal?.pop_latency_ms ?? null,
    format:   v => v == null ? '— ms' : `${Math.round(v)} ms`,
    colorFor: (v, C) => latencyColor(v, C),
  },
  {
    key: 'download',
    label: 'Download',
    shortLabel: 'DOWN',
    direction: 'desc',
    extract:  s => (s as any).download_mbps ?? null,
    format:   v => v == null ? '—' : `${v.toFixed(1)} Mbps`,
    colorFor: (v, C) => v == null ? C.muted : v >= 100 ? C.ok : v >= 25 ? C.warn : C.bad,
  },
  {
    key: 'upload',
    label: 'Upload',
    shortLabel: 'UP',
    direction: 'desc',
    extract:  s => (s as any).upload_mbps ?? null,
    format:   v => v == null ? '—' : `${v.toFixed(1)} Mbps`,
    colorFor: (v, C) => v == null ? C.muted : v >= 15 ? C.ok : v >= 5 ? C.warn : C.bad,
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
    colorFor: (_v, C) => C.ok,
  },
  {
    key: 'uptime',
    label: 'Uptime',
    shortLabel: 'UPTIME',
    direction: 'desc',
    extract:  s => (s as any).uptime_pct ?? null,
    format:   v => v == null ? '—' : `${v.toFixed(1)} %`,
    colorFor: (v, C) => v == null ? C.muted : v >= 98 ? C.ok : v >= 90 ? C.warn : C.bad,
  },
  {
    key: 'ping_drop',
    label: 'Ping drop',
    shortLabel: 'DROP',
    direction: 'asc',
    extract:  s => s.signal?.ping_drop_pct ?? null,
    format:   v => v == null ? '—' : `${v.toFixed(1)} %`,
    colorFor: (v, C) => v == null ? C.muted : v <= 0.5 ? C.ok : v <= 2 ? C.warn : C.bad,
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export function RankingScreen() {
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const [metricKey, setMetricKey] = useState<MetricKey>('score');
  const metric = METRICS.find(m => m.key === metricKey)!;

  const { sites, loading } = useFleetSummary();

  const sorted = useMemo(() => {
    const mult = metric.direction === 'asc' ? 1 : -1;
    return [...sites].sort((a, b) => {
      const va = metric.extract(a);
      const vb = metric.extract(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * mult;
    });
  }, [sites, metric]);

  if (loading && sites.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>

      {/* Metric selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chips, { borderBottomColor: C.rule }]}
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
                  backgroundColor: active ? C.accent : C.surface2,
                  borderColor:     active ? C.accent : C.rule,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? '#fff' : C.ink3 }]}>
                {m.shortLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={[styles.header, { color: C.ink3 }]}>
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
            colors={C}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: C.ink3 }]}>No data yet</Text>
        }
      />
    </View>
  );
}

function RankRow({
  item, rank, metric, colors: C,
}: {
  item: Site; rank: number; metric: MetricDef; colors: Colors;
}) {
  const v       = metric.extract(item);
  const display = metric.format(v);
  const dotColor = metric.colorFor(v, C);

  // Rank badge styling
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  return (
    <View style={[styles.row, { backgroundColor: C.surface, borderColor: C.rule }]}>
      {medal
        ? <Text style={styles.medal}>{medal}</Text>
        : <Text style={[styles.rank, { color: C.muted }]}>#{rank}</Text>}
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.name, { color: C.ink }]} numberOfLines={1}>{item.name}</Text>
      <Text style={[styles.value, { color: dotColor }]}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1 },
  header:   { fontSize: 11, textAlign: 'center', paddingVertical: 6, letterSpacing: 0.5 },
  chips:    { paddingHorizontal: 12, paddingVertical: 10, gap: 6,
              borderBottomWidth: StyleSheet.hairlineWidth },
  chip:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, borderWidth: 1 },
  chipText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6 },
  list:     { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 24 },
  center:   { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:    { textAlign: 'center', marginTop: 40 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8,
              borderWidth: 1, padding: 12, marginBottom: 8 },
  rank:     { width: 30, fontSize: 12 },
  medal:    { width: 30, fontSize: 16, textAlign: 'center' },
  dot:      { width: 8, height: 8, borderRadius: 99 },
  name:     { flex: 1, fontSize: 13 },
  value:    { fontWeight: '700', fontSize: 13 },
});
