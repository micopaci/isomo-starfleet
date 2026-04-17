import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Site, siteStatus, predictCause } from '@starfleet/shared';
import { ScorePill } from './ScorePill';
import { Colors, scoreColor } from '../theme/colors';

interface Props {
  site: Site;
  onPress: () => void;
  colors: Colors;
}

export function SiteCard({ site, onPress, colors }: Props) {
  const status    = siteStatus(site);
  const cause     = predictCause(site.latest_signal ?? null);
  const scoreVal  = site.latest_signal?.score ?? null;
  const lastSeen  = site.latest_signal?.recorded_at
    ? formatAgo(new Date(site.latest_signal.recorded_at))
    : 'no data';

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.row}>
        <View style={styles.nameCol}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {site.name}
          </Text>
          <Text style={[styles.cause, { color: colors.text2 }]} numberOfLines={1}>
            {cause}
          </Text>
        </View>
        <ScorePill score={scoreVal} />
      </View>

      <View style={styles.footer}>
        {/* Status dot */}
        <View style={[styles.dot, { backgroundColor: dotColor(status) }]} />
        <Text style={[styles.meta, { color: colors.text2 }]}>
          {site.online_laptops}/{site.total_laptops} online
        </Text>
        <Text style={[styles.meta, { color: colors.text2 }]}> · {lastSeen}</Text>
      </View>
    </TouchableOpacity>
  );
}

function dotColor(status: string): string {
  if (status === 'online')   return '#22c55e';
  if (status === 'degraded') return '#f59e0b';
  return '#ef4444';
}

function formatAgo(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

const styles = StyleSheet.create({
  card:   { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 10 },
  row:    { flexDirection: 'row', alignItems: 'center' },
  nameCol:{ flex: 1, marginRight: 8 },
  name:   { fontWeight: '600', fontSize: 14 },
  cause:  { fontSize: 12, marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dot:    { width: 7, height: 7, borderRadius: 99, marginRight: 5 },
  meta:   { fontSize: 12 },
});
