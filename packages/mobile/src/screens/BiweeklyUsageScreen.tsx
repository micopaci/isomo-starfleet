import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, useColorScheme,
} from 'react-native';
import { useBiweeklyUsage } from '@starfleet/shared';
import { BiweeklyUsageProps } from '../navigation/types';
import { getApi, getToken, decodeJwtPayload } from '../store/auth';
import { light, dark, Colors } from '../theme/colors';

function bytesToGb(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(2);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(date: string, n: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function BiweeklyUsageScreen({ route }: BiweeklyUsageProps) {
  const { siteId } = route.params;
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const { entries, loading, refresh } = useBiweeklyUsage(siteId);

  const token   = getToken();
  const isAdmin = token ? (decodeJwtPayload(token) as any)?.role === 'admin' : false;

  const today = todayStr();
  const [showForm, setShowForm]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm] = useState({
    period_start: today,
    period_end:   plusDays(today, 14),
    gb_down:      '',
    gb_up:        '',
    notes:        '',
  });

  function setField(key: keyof typeof form) {
    return (v: string) => {
      setForm(f => {
        const next = { ...f, [key]: v };
        if (key === 'period_start') next.period_end = plusDays(v, 14);
        return next;
      });
    };
  }

  async function handleSave() {
    if (!form.period_start || !form.period_end) {
      Alert.alert('Error', 'Period start and end are required.');
      return;
    }
    if (!form.gb_down && !form.gb_up) {
      Alert.alert('Error', 'Provide at least one of GB down or GB up.');
      return;
    }
    const api = getApi();
    if (!api) return;
    setSaving(true);
    try {
      await api.addBiweeklyUsage(siteId, {
        period_start: form.period_start,
        period_end:   form.period_end,
        gb_down: form.gb_down ? Number(form.gb_down) : undefined,
        gb_up:   form.gb_up   ? Number(form.gb_up)   : undefined,
        notes:   form.notes   || undefined,
      });
      setShowForm(false);
      setForm({ period_start: today, period_end: plusDays(today, 14), gb_down: '', gb_up: '', notes: '' });
      refresh();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(entryId: number) {
    Alert.alert('Delete entry', 'Remove this usage record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const api = getApi();
          if (!api) return;
          try {
            await api.deleteBiweeklyUsage(siteId, entryId);
            refresh();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Delete failed.');
          }
        },
      },
    ]);
  }

  if (loading && !entries.length) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.bg }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      {isAdmin && (
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: C.accent }]}
          onPress={() => setShowForm(v => !v)}
        >
          <Text style={styles.addBtnText}>{showForm ? 'Cancel' : '+ Add entry'}</Text>
        </TouchableOpacity>
      )}

      {showForm && isAdmin && (
        <View style={[styles.formCard, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <FormRow label="Period start" value={form.period_start} onChangeText={setField('period_start')} placeholder="YYYY-MM-DD" C={C} />
          <FormRow label="Period end"   value={form.period_end}   onChangeText={setField('period_end')}   placeholder="YYYY-MM-DD" C={C} />
          <FormRow label="GB download"  value={form.gb_down}       onChangeText={setField('gb_down')}      placeholder="e.g. 32.5" keyboardType="decimal-pad" C={C} />
          <FormRow label="GB upload"    value={form.gb_up}         onChangeText={setField('gb_up')}        placeholder="e.g. 4.2"  keyboardType="decimal-pad" C={C} />
          <FormRow label="Notes"        value={form.notes}         onChangeText={setField('notes')}        placeholder="Optional" C={C} />
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: C.accent, opacity: saving ? 0.5 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.addBtnText}>{saving ? 'Saving…' : 'Save entry'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {entries.length === 0 && !showForm && (
        <Text style={[styles.empty, { color: C.muted }]}>No usage entries yet.</Text>
      )}

      {entries.map(entry => {
        const total = entry.bytes_down + entry.bytes_up;
        return (
          <View key={entry.id} style={[styles.entryCard, { backgroundColor: C.surface, borderColor: C.rule }]}>
            <View style={styles.entryHeader}>
              <Text style={[styles.entryPeriod, { color: C.ink }]}>
                {entry.period_start} — {entry.period_end}
              </Text>
              {isAdmin && (
                <TouchableOpacity onPress={() => handleDelete(entry.id)} hitSlop={8}>
                  <Text style={{ color: C.muted, fontSize: 16 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.statsRow}>
              <StatCell label="↓ GB" value={bytesToGb(entry.bytes_down)} C={C} />
              <StatCell label="↑ GB" value={bytesToGb(entry.bytes_up)} C={C} />
              <StatCell label="Total" value={bytesToGb(total)} C={C} />
            </View>
            {entry.notes && (
              <Text style={[styles.entryNotes, { color: C.muted }]}>{entry.notes}</Text>
            )}
            <Text style={[styles.entryBy, { color: C.muted }]}>Entered by {entry.entered_by}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function FormRow({
  label, value, onChangeText, placeholder, keyboardType = 'default', C,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad';
  C: Colors;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        keyboardType={keyboardType}
        style={[styles.formInput, { color: C.ink, borderColor: C.rule }]}
      />
    </View>
  );
}

function StatCell({ label, value, C }: { label: string; value: string; C: Colors }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 11, color: C.muted }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: '600', color: C.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:        { fontSize: 14, textAlign: 'center', marginTop: 32 },
  addBtn:       { borderRadius: 0, paddingVertical: 10, alignItems: 'center', marginBottom: 12 },
  addBtnText:   { color: C.bg, fontWeight: '600', fontSize: 14 },
  saveBtn:      { borderRadius: 0, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  formCard:     { borderRadius: 0, borderWidth: 1, padding: 14, marginBottom: 14 },
  formInput:    { borderWidth: 1, borderRadius: 6, padding: 8, fontSize: 14 },
  entryCard:    { borderRadius: 0, borderWidth: 1, padding: 12, marginBottom: 10 },
  entryHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  entryPeriod:  { flex: 1, fontWeight: '600', fontSize: 13 },
  statsRow:     { flexDirection: 'row', marginBottom: 6 },
  entryNotes:   { fontSize: 12, marginBottom: 4 },
  entryBy:      { fontSize: 11 },
});
