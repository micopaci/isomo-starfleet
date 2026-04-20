import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

interface Props {
  label:  string;
  value:  string | number | null | undefined;
  unit?:  string;
  colors: Colors;
}

export function MetricTile({ label, value, unit, colors }: Props) {
  const display = value != null ? `${value}${unit ?? ''}` : '—';
  return (
    <View style={[styles.tile, { backgroundColor: colors.surface2 }]}>
      <Text style={[styles.label, { color: colors.ink3 }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.ink }]}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile:  { flex: 1, margin: 4, borderRadius: 8, padding: 10, alignItems: 'center' },
  label: { fontSize: 11, marginBottom: 4 },
  value: { fontSize: 18, fontWeight: '700' },
});
