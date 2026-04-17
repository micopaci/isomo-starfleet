import React, { useCallback, useEffect, useState } from 'react';
import {
  View, FlatList, Text, RefreshControl, StyleSheet, useColorScheme,
} from 'react-native';
import { useFleetSummary } from '@starfleet/shared';
import { SiteCard }      from '../components/SiteCard';
import { OfflineBanner } from '../components/OfflineBanner';
import { SitesListProps } from '../navigation/types';
import { saveFleet, loadFleet, ageLabel } from '../store/cache';
import { light, dark, Colors } from '../theme/colors';

export function SitesScreen({ navigation }: SitesListProps) {
  const scheme = useColorScheme();
  const colors: Colors = scheme === 'dark' ? dark : light;

  const { sites, loading, summary } = useFleetSummary();

  // Offline-cache state
  const [offline,   setOffline]   = useState(false);
  const [cachedAge, setCachedAge] = useState('');

  // When live data arrives, persist it
  useEffect(() => {
    if (sites.length > 0) {
      setOffline(false);
      saveFleet(sites);
    }
  }, [sites]);

  // On mount, if no live data yet, try cache
  const [cachedSites, setCachedSites] = useState(sites);
  useEffect(() => {
    if (sites.length === 0 && !loading) {
      loadFleet().then(cached => {
        if (cached) {
          setCachedSites(cached.data);
          setCachedAge(ageLabel(cached.cachedAt));
          setOffline(true);
        }
      });
    } else {
      setCachedSites(sites);
    }
  }, [sites, loading]);

  const displaySites = sites.length > 0 ? sites : cachedSites;

  function onPressSite(siteId: number) {
    navigation.navigate('SiteDetail', { siteId });
  }

  const renderItem = useCallback(
    ({ item }: { item: typeof displaySites[0] }) => (
      <SiteCard site={item} onPress={() => onPressSite(item.id)} colors={colors} />
    ),
    [colors],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {offline && <OfflineBanner label={`Last updated ${cachedAge}`} />}

      <FlatList
        data={displaySites}
        keyExtractor={i => String(i.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} colors={[colors.accent]} />
        }
        ListEmptyComponent={
          !loading
            ? <Text style={[styles.empty, { color: colors.text2 }]}>No sites found</Text>
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list:   { padding: 16 },
  empty:  { textAlign: 'center', marginTop: 40, fontSize: 14 },
});
