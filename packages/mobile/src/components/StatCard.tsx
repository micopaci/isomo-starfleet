import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

interface Props {
  label:  string;
  value:  string | number;
  sub?:   string;
  color?: string;
  icon?:  string;
  colors: Colors;
}

export function StatCard({ label, value, sub, color, icon, colors }: Props) {
  const accent = color ?? colors.accent;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule, borderLeftColor: accent }]}>
      {icon && <Text style={styles.icon}>{icon}</Text>}
      <Text style={[styles.value, { color: accent }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.ink3 }]}>{label}</Text>
      {sub && <Text style={[styles.sub, { color: colors.muted }]}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card:  {
    flex: 1, borderRadius: 10, borderWidth: 1, borderLeftWidth: 3,
    padding: 12, gap: 2,
  },
  icon:  { fontSize: 18, marginBottom: 4 },
  value: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  label: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  sub:   { fontSize: 11, marginTop: 2 },
});
