import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SitesStackParamList } from './types';
import { SitesScreen }       from '../screens/SitesScreen';
import { SiteDetailScreen }  from '../screens/SiteDetailScreen';
import { LaptopDetailScreen } from '../screens/LaptopDetailScreen';

const Stack = createNativeStackNavigator<SitesStackParamList>();

export function SitesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="SitesList"
        component={SitesScreen}
        options={{ title: 'Sites' }}
      />
      <Stack.Screen
        name="SiteDetail"
        component={SiteDetailScreen}
        options={{ title: 'Site Detail' }}
      />
      <Stack.Screen
        name="LaptopDetail"
        component={LaptopDetailScreen}
        options={({ route }) => ({ title: route.params.deviceName })}
      />
    </Stack.Navigator>
  );
}
