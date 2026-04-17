import React, { useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { AppNavigator } from './AppNavigator';
import { LoginScreen }  from '../screens/LoginScreen';
import { Colors }       from '../theme/colors';
import { useFCM }       from '../hooks/useFCM';

const Stack = createNativeStackNavigator<RootStackParamList>();

interface Props {
  authed: boolean;
  colors: Colors;
  onLogin:  () => void;
  onLogout: () => void;
  role:  string;
  email: string;
}

export function RootNavigator({ authed, colors, onLogin, onLogout, role, email }: Props) {
  const navRef = useRef<NavigationContainerRef<any>>(null);
  useFCM(navRef);

  return (
    <NavigationContainer
      ref={navRef}
      theme={{
        dark: false,
        colors: {
          primary:      colors.accent,
          background:   colors.bg,
          card:         colors.bg2,
          text:         colors.text,
          border:       colors.border,
          notification: colors.accent,
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!authed ? (
          <Stack.Screen name="Login">
            {() => <LoginScreen colors={colors} onLogin={onLogin} />}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Main">
            {() => (
              <AppNavigator
                colors={colors}
                onLogout={onLogout}
                role={role}
                email={email}
              />
            )}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
