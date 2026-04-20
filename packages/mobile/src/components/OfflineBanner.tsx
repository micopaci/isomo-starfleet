import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props { label: string; }

export function OfflineBanner({ label }: Props) {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>📵 Offline · {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#92400e', paddingVertical: 6, paddingHorizontal: 16 },
  text:   { color: '#fef3c7', fontSize: 12, fontWeight: '500' },
});
