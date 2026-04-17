import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Switch, useColorScheme, Alert,
} from 'react-native';
import { Colors } from '../theme/colors';
import { clearToken, getApiBase, getToken, decodeJwtPayload } from '../store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_KEY = 'starfleet_api_base';

interface Props {
  colors:   Colors;
  onLogout: () => void;
  role:     string;
  email:    string;
}

export function SettingsScreen({ colors, onLogout, role, email }: Props) {
  const [apiBase,    setApiBase]    = useState(getApiBase());
  const [editingApi, setEditingApi] = useState(false);
  const [savedMsg,   setSavedMsg]   = useState('');
  const s = makeStyles(colors);

  async function handleSaveApiBase() {
    if (!apiBase.trim()) return;
    await AsyncStorage.setItem(API_BASE_KEY, apiBase.trim());
    setSavedMsg('Saved — restart the app to reconnect.');
    setEditingApi(false);
    setTimeout(() => setSavedMsg(''), 4000);
  }

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel',  style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await clearToken();
          onLogout();
        },
      },
    ]);
  }

  const token   = getToken();
  const payload = token ? decodeJwtPayload(token) : null;
  const exp     = payload?.exp ? new Date((payload.exp as number) * 1000) : null;

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={s.content}
    >
      {/* ── Profile card ── */}
      <Section title="Account" colors={colors}>
        <InfoRow label="Email"     value={email || '—'}            colors={colors} />
        <InfoRow label="Role"      value={(role || '—').toUpperCase()} colors={colors} />
        {exp && (
          <InfoRow
            label="Session expires"
            value={exp.toLocaleString()}
            colors={colors}
          />
        )}
      </Section>

      {/* ── API endpoint ── */}
      <Section title="Server" colors={colors}>
        {editingApi ? (
          <View style={s.inputRow}>
            <TextInput
              style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg3 }]}
              value={apiBase}
              onChangeText={setApiBase}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://your-backend.com"
              placeholderTextColor={colors.text2}
            />
            <TouchableOpacity style={[s.saveBtn, { backgroundColor: colors.accent }]} onPress={handleSaveApiBase}>
              <Text style={s.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditingApi(true)}>
            <InfoRow label="API Base URL" value={apiBase} colors={colors} />
            <Text style={[s.editHint, { color: colors.accent }]}>Tap to edit</Text>
          </TouchableOpacity>
        )}
        {!!savedMsg && <Text style={[s.savedMsg, { color: colors.degraded }]}>{savedMsg}</Text>}
      </Section>

      {/* ── About ── */}
      <Section title="About" colors={colors}>
        <InfoRow label="App"     value="Starfleet Monitor"      colors={colors} />
        <InfoRow label="Version" value="1.0.0"                  colors={colors} />
        <InfoRow label="Org"     value="Isomo Circles Rwanda"   colors={colors} />
      </Section>

      {/* ── Sign out ── */}
      <TouchableOpacity style={[s.logoutBtn, { borderColor: '#ef4444' }]} onPress={handleLogout}>
        <Text style={s.logoutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title, children, colors,
}: { title: string; children: React.ReactNode; colors: Colors }) {
  return (
    <View style={[sectionStyles.wrap, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <Text style={[sectionStyles.title, { color: colors.text2 }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={rowStyles.row}>
      <Text style={[rowStyles.label, { color: colors.text2 }]}>{label}</Text>
      <Text style={[rowStyles.value, { color: colors.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen:     { flex: 1 },
    content:    { padding: 16, gap: 16, paddingBottom: 40 },
    inputRow:   { flexDirection: 'row', gap: 8, alignItems: 'center' },
    input:      { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10,
                  paddingVertical: 8, fontSize: 13 },
    saveBtn:    { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
    saveBtnText:{ color: '#fff', fontWeight: '600', fontSize: 13 },
    editHint:   { fontSize: 11, marginTop: 2 },
    savedMsg:   { fontSize: 12, marginTop: 4 },
    logoutBtn:  { borderWidth: 1.5, borderRadius: 10, padding: 14,
                  alignItems: 'center', marginTop: 4 },
    logoutText: { color: '#ef4444', fontWeight: '600', fontSize: 15 },
    degraded:   c.degraded,
  });
}

const sectionStyles = StyleSheet.create({
  wrap:  { borderRadius: 10, borderWidth: 1, padding: 14, gap: 10 },
  title: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 2 },
});

const rowStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, flex: 0.45 },
  value: { fontSize: 13, fontWeight: '500', flex: 0.55, textAlign: 'right' },
});
