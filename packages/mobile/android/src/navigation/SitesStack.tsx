import React from 'react';
import { useColorScheme } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SitesStackParamList } from './types';
import { SitesScreen }        from '../screens/SitesScreen';
import { SiteDetailScreen }   from '../screens/SiteDetailScreen';
import { DeviceDetailScreen } from '../screens/DeviceDetailScreen';
import { light, dark }        from '../theme/colors';

const Stack = createNativeStackNavigator<SitesStackParamList>();

export function SitesStack() {
  const scheme = useColorScheme();
  const C = scheme === 'dark' ? dark : light;

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle:      { backgroundColor: C.surface },
        headerTintColor:  C.ink,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle:     { backgroundColor: C.bg },
      }}
    >
      <Stack.Screen name="SitesList"    component={SitesScreen}        options={{ title: 'Campuses' }} />
      <Stack.Screen name="SiteDetail"   component={SiteDetailScreen}   options={{ title: 'Site Detail' }} />
      <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} options={({ route }) => ({ title: route.params.deviceName })} />
    </Stack.Navigator>
  );
}
