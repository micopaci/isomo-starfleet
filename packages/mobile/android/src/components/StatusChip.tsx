import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

type Status = 'online' | 'degraded' | 'offline' | 'stale' | 'dark';

interface Props {
  status: Status;
  colors: Colors;
  small?: boolean;
}

const LABELS: Record<Status, string> = {
  online:   'Online',
  degraded: 'Degraded',
  offline:  'Offline',
  stale:    'Stale',
  dark:     'Dark',
};

export function StatusChip({ status, colors, small }: Props) {
  const bgMap: Record<Status, string> = {
    online:   colors.okSoft,
    degraded: colors.warnSoft,
    offline:  colors.badSoft,
    stale:    colors.warnSoft,
    dark:     colors.muteSoft,
  };
  const fgMap: Record<Status, string> = {
    online:   colors.ok,
    degraded: colors.warn,
    offline:  colors.bad,
    stale:    colors.warn,
    dark:     colors.muted,
  };

  return (
    <View style={[
      styles.chip,
      { backgroundColor: bgMap[status], paddingHorizontal: small ? 6 : 8, paddingVertical: small ? 2 : 3 },
    ]}>
      <View style={[styles.dot, { backgroundColor: fgMap[status] }]} />
      <Text style={[styles.label, { color: fgMap[status], fontSize: small ? 10 : 11 }]}>
        {LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip:  { flexDirection: 'row', alignItems: 'center', borderRadius: 99, gap: 4 },
  dot:   { width: 5, height: 5, borderRadius: 99 },
  label: { fontWeight: '600', letterSpacing: 0.2 },
});
