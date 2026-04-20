import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from 'react-native-reanimated';
import { StarfleetApi } from '@starfleet/shared';
import { storeToken, getApiBase } from '../store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../theme/colors';

const API_BASE_KEY = 'starfleet_api_base';

interface Props { colors: Colors; onLogin: () => void; }

export function LoginScreen({ colors, onLogin }: Props) {
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [apiBase,    setApiBase]    = useState(getApiBase());
  const [showServer, setShowServer] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, []);
  const logoAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  async function handleLogin() {
    if (!email || !password) { setError('Email and password required'); return; }
    setLoading(true); setError('');
    try {
      const base = apiBase.trim() || getApiBase();
      await AsyncStorage.setItem(API_BASE_KEY, base);
      const api = new StarfleetApi(base, () => '');
      const { token } = await api.login(email.trim(), password);
      await storeToken(token, base);
      onLogin();
    } catch (e: any) {
      setError(e?.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <Animated.View style={[s.logoWrap, logoAnim]}>
            <Text style={s.logo}>📡</Text>
          </Animated.View>
          <Text style={[s.title, { color: colors.ink }]}>Starfleet Monitor</Text>
          <Text style={[s.sub,   { color: colors.ink3 }]}>Isomo Circles Fleet Dashboard</Text>

          <TextInput
            style={[s.input, { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.surface2 }]}
            placeholder="Email" placeholderTextColor={colors.muted}
            autoCapitalize="none" keyboardType="email-address"
            value={email} onChangeText={setEmail} returnKeyType="next"
          />
          <TextInput
            style={[s.input, { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.surface2 }]}
            placeholder="Password" placeholderTextColor={colors.muted}
            secureTextEntry value={password} onChangeText={setPassword}
            onSubmitEditing={handleLogin} returnKeyType="go"
          />

          {!!error && <Text style={s.error}>{error}</Text>}

          <TouchableOpacity
            style={[s.btn, { backgroundColor: colors.accent }]}
            onPress={handleLogin} disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setShowServer(v => !v)} style={s.toggleWrap}>
            <Text style={[s.toggleText, { color: colors.muted }]}>
              {showServer ? '▲ Hide server' : '▼ Server settings'}
            </Text>
          </TouchableOpacity>

          {showServer && (
            <TextInput
              style={[s.input, { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.surface2 }]}
              placeholder="https://api.starfleet.yourdomain.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none" autoCorrect={false} keyboardType="url"
              value={apiBase} onChangeText={setApiBase}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll:     { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card:       { borderRadius: 16, borderWidth: 1, padding: 28, gap: 14 },
  logoWrap:   { alignItems: 'center' },
  logo:       { fontSize: 52 },
  title:      { textAlign: 'center', fontSize: 20, fontWeight: '700' },
  sub:        { textAlign: 'center', fontSize: 13, marginBottom: 4 },
  input:      { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  error:      { color: '#dc2626', fontSize: 13, textAlign: 'center' },
  btn:        { borderRadius: 10, padding: 14, alignItems: 'center' },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  toggleWrap: { alignItems: 'center' },
  toggleText: { fontSize: 12 },
});
