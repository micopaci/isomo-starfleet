import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TabParamList }      from './types';
import { SitesStack }        from './SitesStack';
import { OverviewScreen }    from '../screens/OverviewScreen';
import { MapScreen }         from '../screens/MapScreen';
import { StarlinksScreen }   from '../screens/StarlinksScreen';
import { AlertsScreen }      from '../screens/AlertsScreen';
import { SettingsScreen }    from '../screens/SettingsScreen';
import { Colors }            from '../theme/colors';
import { getApi }            from '../store/auth';

const Tab = createBottomTabNavigator<TabParamList>();

interface Props {
  colors:   Colors;
  onLogout: () => void;
  role:     string;
  email:    string;
}

export function AppNavigator({ colors, onLogout, role, email }: Props) {
  const [alertCount, setAlertCount] = useState(0);

  // Poll for unacknowledged alerts to show badge
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const api = getApi();
        if (!api) return;
        const changes: any[] = await api.get('/site-changes');
        if (!cancelled) setAlertCount(changes.filter((c: any) => !c.acknowledged_at).length);
      } catch { /* silent */ }
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor:  colors.rule,
          borderTopWidth:  1,
          paddingBottom:   4,
          height:          58,
        },
        tabBarActiveTintColor:   colors.accent,
        tabBarInactiveTintColor: colors.ink3,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 2 },
      }}
    >
      <Tab.Screen
        name="Overview"
        component={OverviewScreen}
        options={{ tabBarIcon: ({ color }) => <TabIcon icon="🏠" color={color} />, tabBarLabel: 'Overview' }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon icon="🗺️" color={color} />,
          tabBarLabel: 'Map',
          headerShown: true,
          headerTitle: 'Fleet Map',
          headerStyle:     { backgroundColor: colors.surface },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
        }}
      />
      <Tab.Screen
        name="Sites"
        component={SitesStack}
        options={{ tabBarIcon: ({ color }) => <TabIcon icon="📡" color={color} />, tabBarLabel: 'Campuses' }}
      />
      <Tab.Screen
        name="Starlinks"
        component={StarlinksScreen}
        options={{ tabBarIcon: ({ color }) => <TabIcon icon="📶" color={color} />, tabBarLabel: 'Starlinks' }}
      />
      <Tab.Screen
        name="Alerts"
        options={{
          tabBarIcon:  ({ color }) => <TabIcon icon="🔔" color={color} />,
          tabBarLabel: 'Alerts',
          tabBarBadge: alertCount > 0 ? alertCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.bad, fontSize: 10 },
        }}
      >
        {() => <AlertsScreen colors={colors} role={role} onAlertCountChange={setAlertCount} />}
      </Tab.Screen>
      <Tab.Screen
        name="Settings"
        options={{ tabBarIcon: ({ color }) => <TabIcon icon="⚙️" color={color} />, tabBarLabel: 'Settings' }}
      >
        {() => <SettingsScreen colors={colors} onLogout={onLogout} role={role} email={email} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 20 }}>{icon}</Text>;
}
