import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { dark, scoreColor } from '../theme/colors';

interface Props {
  score: number | null | undefined;
  size?: 'sm' | 'lg';
}

export function ScorePill({ score, size = 'sm' }: Props) {
  const label = score != null ? String(Math.round(score)) : '—';
  const bg    = score != null ? scoreColor(score) : dark.muted;
  return (
    <View style={[styles.pill, { backgroundColor: bg }, size === 'lg' && styles.large]}>
      <Text style={[styles.text, size === 'lg' && styles.textLarge]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill:      { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 0 },
  text:      { color: dark.bg, fontWeight: '600', fontSize: 12 },
  large:     { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 0 },
  textLarge: { fontSize: 36, fontWeight: '700' },
});
