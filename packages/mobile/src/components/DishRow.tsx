import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, scoreColor } from '../theme/colors';
import { StatusChip } from './StatusChip';

interface DishRowProps {
  siteName:     string;
  serial:       string;
  score:        number | null;
  downloadMbps: number | null;
  uploadMbps:   number | null;
  status:       'online' | 'degraded' | 'offline';
  colors:       Colors;
  onPress?:     () => void;
}

export function DishRow({ siteName, serial, score, downloadMbps, uploadMbps, status, colors, onPress }: DishRowProps) {
  const scoreVal = score != null ? Math.round(score) : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.rule }]}
    >
      <View style={[styles.accent, { backgroundColor: scoreVal != null ? scoreColor(scoreVal, colors) : colors.muted }]} />
      <View style={styles.main}>
        <View style={styles.topLine}>
          <Text style={[styles.site, { color: colors.ink }]} numberOfLines={1}>{siteName}</Text>
          <StatusChip status={status} colors={colors} small />
        </View>
        <Text style={[styles.serial, { color: colors.muted }]}>{serial || '—'}</Text>
        <View style={styles.metrics}>
          {scoreVal != null && (
            <Text style={[styles.metric, { color: scoreColor(scoreVal, colors) }]}>Score {scoreVal}</Text>
          )}
          {downloadMbps != null && (
            <Text style={[styles.metric, { color: colors.ink3 }]}>↓ {downloadMbps.toFixed(1)} Mbps</Text>
          )}
          {uploadMbps != null && (
            <Text style={[styles.metric, { color: colors.ink3 }]}>↑ {uploadMbps.toFixed(1)} Mbps</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', borderRadius: 10, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  accent:  { width: 4 },
  main:    { flex: 1, padding: 12, gap: 4 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  site:    { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  serial:  { fontSize: 11, fontFamily: 'monospace' },
  metrics: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  metric:  { fontSize: 12, fontWeight: '500' },
});
