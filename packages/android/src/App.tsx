/**
 * App.tsx — Root entry point for Starfleet Monitor (Android).
 *
 * Responsibilities:
 *  1. On mount, restore a persisted JWT from AsyncStorage.
 *  2. If a token is found, initialise the API + WS clients.
 *  3. Pass auth state down to RootNavigator (Login vs Main tabs).
 *  4. Derive light/dark colours from the OS colour scheme.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, useColorScheme, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './navigation/RootNavigator';
import { light, dark }   from './theme/colors';
import {
  loadStoredCredentials,
  initClients,
  clearToken,
  getToken,
  decodeJwtPayload,
} from './store/auth';

type BootState = 'loading' | 'authed' | 'guest';

export default function App() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? dark : light;

  const [boot, setBoot] = useState<BootState>('loading');
  const [role,  setRole]  = useState('viewer');
  const [email, setEmail] = useState('');

  // ── Parse role + email from stored JWT ────────────────────────────────────
  function hydrateUserMeta() {
    const token = getToken();
    if (!token) return;
    const payload = decodeJwtPayload(token) as any;
    setRole(payload?.role  ?? 'viewer');
    setEmail(payload?.email ?? payload?.sub ?? '');
  }

  // ── Bootstrap on first render ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const hasToken = await loadStoredCredentials();
      if (hasToken) {
        initClients(handleAuthError);
        hydrateUserMeta();
        setBoot('authed');
      } else {
        setBoot('guest');
      }
    })();
  }, []);

  // ── Called when the API receives 401 ─────────────────────────────────────
  const handleAuthError = useCallback(async () => {
    await clearToken();
    setBoot('guest');
  }, []);

  // ── Login callback (after LoginScreen succeeds) ───────────────────────────
  const handleLogin = useCallback(() => {
    initClients(handleAuthError);
    hydrateUserMeta();
    setBoot('authed');
  }, [handleAuthError]);

  // ── Logout callback ───────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    await clearToken();
    setRole('viewer');
    setEmail('');
    setBoot('guest');
  }, []);

  // ── Splash / loading state ────────────────────────────────────────────────
  if (boot === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <RootNavigator
        authed={boot === 'authed'}
        colors={colors}
        onLogin={handleLogin}
        onLogout={handleLogout}
        role={role}
        email={email}
      />
    </SafeAreaProvider>
  );
}
