import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  label: string; // e.g. "Last updated 12 min ago"
}

export function OfflineBanner({ label }: Props) {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>⚠ Offline — {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#f59e0b',
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});
