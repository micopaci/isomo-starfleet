import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Colors } from '../theme/colors';

interface AlertRowProps {
  type:         'location' | 'stale';
  siteName:     string;
  description:  string;
  timeAgo:      string;
  acknowledged: boolean;
  canAck:       boolean;
  acking:       boolean;
  onAck?:       () => void;
  colors:       Colors;
}

export function AlertRow({ type, siteName, description, timeAgo, acknowledged, canAck, acking, onAck, colors }: AlertRowProps) {
  const icon = type === 'location' ? '📍' : '⏱️';

  return (
    <View style={[
      styles.row,
      {
        backgroundColor: acknowledged ? colors.surface2 : colors.surface,
        borderColor: acknowledged ? colors.rule2 : colors.rule,
        opacity: acknowledged ? 0.7 : 1,
      },
    ]}>
      <Text style={styles.icon}>{icon}</Text>
      <View style={styles.body}>
        <Text style={[styles.site, { color: colors.ink }]} numberOfLines={1}>{siteName}</Text>
        <Text style={[styles.desc, { color: colors.ink3 }]} numberOfLines={2}>{description}</Text>
        <Text style={[styles.time, { color: colors.muted }]}>{timeAgo}</Text>
      </View>
      {!acknowledged && canAck && (
        <TouchableOpacity
          onPress={onAck}
          disabled={acking}
          style={[styles.ackBtn, { borderColor: colors.accent }]}
        >
          {acking
            ? <ActivityIndicator size="small" color={colors.accent} />
            : <Text style={[styles.ackText, { color: colors.accent }]}>ACK</Text>}
        </TouchableOpacity>
      )}
      {acknowledged && (
        <View style={[styles.ackDone, { backgroundColor: colors.okSoft }]}>
          <Text style={[styles.ackDoneText, { color: colors.ok }]}>✓</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8, alignItems: 'flex-start', gap: 10 },
  icon:      { fontSize: 20, marginTop: 1 },
  body:      { flex: 1, gap: 3 },
  site:      { fontSize: 13, fontWeight: '600' },
  desc:      { fontSize: 12 },
  time:      { fontSize: 11 },
  ackBtn:    { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center', justifyContent: 'center', minWidth: 48 },
  ackText:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  ackDone:   { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, alignItems: 'center', justifyContent: 'center' },
  ackDoneText:{ fontSize: 13, fontWeight: '700' },
});
