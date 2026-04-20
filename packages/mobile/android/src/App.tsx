/**
 * App.tsx — Root entry point for Starfleet Monitor (Android/iOS).
 * NOTE: react-native-gesture-handler import must be first in index.js.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, useColorScheme, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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

  const [boot,  setBoot]  = useState<BootState>('loading');
  const [role,  setRole]  = useState('viewer');
  const [email, setEmail] = useState('');

  function hydrateUserMeta() {
    const token = getToken();
    if (!token) return;
    const payload = decodeJwtPayload(token) as any;
    setRole(payload?.role  ?? 'viewer');
    setEmail(payload?.email ?? payload?.sub ?? '');
  }

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

  const handleAuthError = useCallback(async () => {
    await clearToken();
    setBoot('guest');
  }, []);

  const handleLogin = useCallback(() => {
    initClients(handleAuthError);
    hydrateUserMeta();
    setBoot('authed');
  }, [handleAuthError]);

  const handleLogout = useCallback(async () => {
    await clearToken();
    setRole('viewer');
    setEmail('');
    setBoot('guest');
  }, []);

  if (boot === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
    </GestureHandlerRootView>
  );
}
