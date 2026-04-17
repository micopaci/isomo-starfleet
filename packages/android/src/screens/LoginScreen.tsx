import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { StarfleetApi } from '@starfleet/shared';
import { storeToken, getApiBase } from '../store/auth';
import { Colors } from '../theme/colors';

interface Props {
  colors: Colors;
  onLogin: () => void;
}

export function LoginScreen({ colors, onLogin }: Props) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleLogin() {
    if (!email || !password) { setError('Email and password required'); return; }
    setLoading(true); setError('');
    try {
      // Use a no-token API instance just for the login POST
      const base = getApiBase();
      const anonApi = new StarfleetApi(base, () => '');
      const { token } = await anonApi.login(email.trim(), password);
      await storeToken(token, base);
      onLogin();
    } catch (e: any) {
      setError(e?.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  const s = makeStyles(colors);
  return (
    <KeyboardAvoidingView
      style={[s.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.card}>
        <Text style={s.logo}>📡</Text>
        <Text style={s.title}>Starfleet Monitor</Text>
        <Text style={s.sub}>Isomo Circles Fleet Dashboard</Text>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor={colors.text2}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor={colors.text2}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
        />

        {!!error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Sign in</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    card:   { width: '100%', maxWidth: 360, backgroundColor: c.bg2, borderRadius: 12,
              borderWidth: 1, borderColor: c.border, padding: 28, gap: 12 },
    logo:   { textAlign: 'center', fontSize: 48 },
    title:  { textAlign: 'center', fontSize: 20, fontWeight: '700', color: c.text },
    sub:    { textAlign: 'center', fontSize: 13, color: c.text2, marginBottom: 4 },
    input:  { borderWidth: 1, borderColor: c.border, borderRadius: 8,
              paddingHorizontal: 12, paddingVertical: 10,
              backgroundColor: c.bg3, color: c.text, fontSize: 15 },
    error:  { color: '#ef4444', fontSize: 12 },
    btn:    { backgroundColor: c.accent, borderRadius: 8, padding: 12, alignItems: 'center' },
    btnText:{ color: '#fff', fontWeight: '600', fontSize: 15 },
  });
}
