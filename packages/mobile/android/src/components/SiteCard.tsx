import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Site } from '@starfleet/shared';
import { Colors, scoreColor } from '../theme/colors';
import { StatusChip } from './StatusChip';

interface Props {
  site:    Site;
  onPress: () => void;
  colors:  Colors;
}

function derivedStatus(s: Site): 'online' | 'degraded' | 'offline' {
  const score = Number((s as any).score ?? (s as any).score_7day_avg ?? 0);
  if (score >= 70) return 'online';
  if (score >= 40) return 'degraded';
  return 'offline';
}

export function SiteCard({ site, onPress, colors }: Props) {
  const status        = derivedStatus(site);
  const score         = (site as any).score ?? (site as any).score_7day_avg ?? null;
  const dishesTotal   = (site as any).dishes_total  ?? 0;
  const dishesOnline  = (site as any).dishes_online ?? 0;
  const devicesOnline = (site as any).online_laptops ?? 0;
  const scoreVal      = score != null ? Math.round(Number(score)) : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}
      activeOpacity={0.7}
    >
      <View style={styles.topRow}>
        <View style={styles.nameWrap}>
          <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>{site.name}</Text>
          {(site as any).site_code && (
            <Text style={[styles.code, { color: colors.muted }]}>{(site as any).site_code}</Text>
          )}
        </View>
        <StatusChip status={status} colors={colors} small />
      </View>

      <View style={styles.bottomRow}>
        <Text style={[styles.meta, { color: colors.ink3 }]}>
          📡 {dishesOnline}/{dishesTotal} · 💻 {devicesOnline}
        </Text>
        {scoreVal != null && (
          <View style={[styles.scorePill, { backgroundColor: colors.surface2 }]}>
            <Text style={[styles.scoreText, { color: scoreColor(scoreVal, colors) }]}>
              {scoreVal}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card:      { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 10, gap: 8 },
  topRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  nameWrap:  { flex: 1, gap: 2 },
  name:      { fontSize: 14, fontWeight: '600' },
  code:      { fontSize: 11, letterSpacing: 0.3 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta:      { fontSize: 12 },
  scorePill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText: { fontSize: 13, fontWeight: '700' },
});
