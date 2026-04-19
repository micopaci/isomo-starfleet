import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TabParamList } from './types';
import { SitesStack }      from './SitesStack';
import { MapScreen }       from '../screens/MapScreen';
import { RankingScreen }   from '../screens/RankingScreen';
import { SettingsScreen }  from '../screens/SettingsScreen';
import { Colors } from '../theme/colors';

const Tab = createBottomTabNavigator<TabParamList>();

interface Props {
  colors: Colors;
  onLogout: () => void;
  role: string;
  email: string;
}

export function AppNavigator({ colors, onLogout, role, email }: Props) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle:            { backgroundColor: colors.bg2, borderTopColor: colors.border },
        tabBarActiveTintColor:  colors.accent,
        tabBarInactiveTintColor: colors.text2,
      }}
    >
      <Tab.Screen
        name="Sites"
        component={SitesStack}
        options={{
          tabBarIcon: ({ color }) => <TabIcon label="📡" color={color} />,
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon label="🗺️" color={color} />,
          headerShown: true,
          headerTitle: 'Fleet Map',
          headerStyle: { backgroundColor: colors.bg2 },
          headerTintColor: colors.ink,
        }}
      />
      <Tab.Screen
        name="Ranking"
        component={RankingScreen}
        options={{
          tabBarIcon: ({ color }) => <TabIcon label="📊" color={color} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        options={{
          tabBarIcon: ({ color }) => <TabIcon label="⚙️" color={color} />,
        }}
      >
        {() => <SettingsScreen colors={colors} onLogout={onLogout} role={role} email={email} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

import { Text } from 'react-native';
function TabIcon({ label, color }: { label: string; color: string }) {
  return <Text style={{ fontSize: 20 }}>{label}</Text>;
}
