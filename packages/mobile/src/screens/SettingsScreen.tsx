import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, useColorScheme, Alert,
} from 'react-native';
import { Colors, light, dark } from '../theme/colors';
import { clearToken, getApiBase, getToken, decodeJwtPayload } from '../store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_KEY = 'starfleet_api_base';

interface Props {
  colors?:  Colors;
  onLogout: () => void;
  role?:    string;
  email?:   string;
}

export function SettingsScreen({ colors, onLogout, role, email }: Props) {
  const scheme = useColorScheme();
  const C: Colors = colors ?? (scheme === 'dark' ? dark : light);

  const [apiBase,    setApiBase]    = useState(getApiBase());
  const [editingApi, setEditingApi] = useState(false);
  const [savedMsg,   setSavedMsg]   = useState('');

  async function handleSaveApiBase() {
    if (!apiBase.trim()) return;
    await AsyncStorage.setItem(API_BASE_KEY, apiBase.trim());
    setSavedMsg('Saved — restart the app to reconnect.');
    setEditingApi(false);
    setTimeout(() => setSavedMsg(''), 4000);
  }

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel',   style: 'cancel' },
      {
        text:  'Sign out',
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
  const resolvedRole  = role  ?? (payload as any)?.role  ?? '—';
  const resolvedEmail = email ?? (payload as any)?.email ?? '—';

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.bg }]}
      contentContainerStyle={styles.content}
    >

      {/* Account */}
      <Section title="Account" C={C}>
        <InfoRow label="Email"           value={resolvedEmail}                 C={C} />
        <InfoRow label="Role"            value={resolvedRole.toUpperCase()}     C={C} />
        {exp && (
          <InfoRow label="Session expires" value={exp.toLocaleString()}         C={C} />
        )}
      </Section>

      {/* Server */}
      <Section title="Server" C={C}>
        {editingApi ? (
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { color: C.ink, borderColor: C.rule, backgroundColor: C.surface2 }]}
              value={apiBase}
              onChangeText={setApiBase}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://your-backend.com"
              placeholderTextColor={C.muted}
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: C.accent }]}
              onPress={handleSaveApiBase}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditingApi(true)}>
            <InfoRow label="API Base URL" value={apiBase || '—'} C={C} />
            <Text style={[styles.editHint, { color: C.accent }]}>Tap to edit</Text>
          </TouchableOpacity>
        )}
        {!!savedMsg && (
          <Text style={[styles.savedMsg, { color: C.ok }]}>{savedMsg}</Text>
        )}
      </Section>

      {/* About */}
      <Section title="About" C={C}>
        <InfoRow label="App"     value="Starfleet Monitor"    C={C} />
        <InfoRow label="Version" value="2.0.0"                C={C} />
        <InfoRow label="Org"     value="Isomo Circles Rwanda" C={C} />
      </Section>

      {/* Sign out */}
      <TouchableOpacity
        style={[styles.logoutBtn, { borderColor: C.bad }]}
        onPress={handleLogout}
      >
        <Text style={[styles.logoutText, { color: C.bad }]}>Sign out</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title, children, C,
}: { title: string; children: React.ReactNode; C: Colors }) {
  return (
    <View style={[sS.wrap, { backgroundColor: C.surface, borderColor: C.rule }]}>
      <Text style={[sS.title, { color: C.ink3 }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value, C }: { label: string; value: string; C: Colors }) {
  return (
    <View style={rS.row}>
      <Text style={[rS.label, { color: C.ink3 }]}>{label}</Text>
      <Text style={[rS.value, { color: C.ink }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:      { flex: 1 },
  content:     { padding: 16, gap: 16, paddingBottom: 40 },
  inputRow:    { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:       { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10,
                 paddingVertical: 8, fontSize: 13 },
  saveBtn:     { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  editHint:    { fontSize: 11, marginTop: 2 },
  savedMsg:    { fontSize: 12, marginTop: 4 },
  logoutBtn:   { borderWidth: 1.5, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  logoutText:  { fontWeight: '600', fontSize: 15 },
});

const sS = StyleSheet.create({
  wrap:  { borderRadius: 10, borderWidth: 1, padding: 14, gap: 10 },
  title: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 2 },
});

const rS = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, flex: 0.45 },
  value: { fontSize: 13, fontWeight: '500', flex: 0.55, textAlign: 'right' },
});
