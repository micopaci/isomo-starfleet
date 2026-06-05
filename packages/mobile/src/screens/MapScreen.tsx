import React, { useState, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, useColorScheme,
} from 'react-native';
import {
  Map, Camera, GeoJSONSource, Layer,
  type CameraRef,
  type CircleLayerStyle,
} from '@maplibre/maplibre-react-native';
import { useFleetSummary } from '@starfleet/shared';
import { light, dark, Colors, scoreColor } from '../theme/colors';

const RWANDA_CENTER: [number, number] = [29.87, -1.94];
const MAX_BOUNDS: [number, number, number, number] = [28.36, -3.34, 31.40, -0.55];

const TILE_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const DARK_TILE_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function pinColor(score: number | null | undefined, C: Colors): string {
  if (score == null) return C.muted;
  return scoreColor(Number(score), C);
}

export function MapScreen() {
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;
  const cameraRef = useRef<CameraRef>(null);

  const { sites, loading } = useFleetSummary();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = useMemo(
    () => sites.find(s => s.id === selectedId) ?? null,
    [sites, selectedId],
  );

  const pins = useMemo(() =>
    sites.filter(s => s.lat != null && s.lng != null),
    [sites],
  );

  const geojson: GeoJSON.FeatureCollection = useMemo(() => ({
    type: 'FeatureCollection',
    features: pins.map(s => ({
      type: 'Feature' as const,
      id: s.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [Number(s.lng), Number(s.lat)],
      },
      properties: {
        id: s.id,
        name: s.name,
        color: pinColor((s as any).score, C),
        selected: s.id === selectedId ? 1 : 0,
      },
    })),
  }), [pins, selectedId, C]);

  const handlePress = (e: any) => {
    const feature = e?.nativeEvent?.payload?.features?.[0]
      ?? e?.features?.[0];
    if (!feature) return;
    const id = feature.properties?.id;
    if (id == null) return;
    const numId = Number(id);
    setSelectedId(prev => prev === numId ? null : numId);
    const coords = feature.geometry?.coordinates;
    if (coords && cameraRef.current) {
      cameraRef.current.flyTo({
        center: coords as [number, number],
        zoom: 11,
        duration: 600,
      });
    }
  };

  const outerStyle: CircleLayerStyle = {
    circleRadius: ['case', ['==', ['get', 'selected'], 1], 10, 7] as any,
    circleColor: '#ffffff',
    circleStrokeColor: ['get', 'color'] as any,
    circleStrokeWidth: 2,
  };

  const innerStyle: CircleLayerStyle = {
    circleRadius: ['case', ['==', ['get', 'selected'], 1], 5, 3] as any,
    circleColor: ['get', 'color'] as any,
  };

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>
      {/* @ts-expect-error React.memo children typing */}
      <Map
        style={styles.map}
        mapStyle={scheme === 'dark' ? DARK_TILE_STYLE : TILE_STYLE}
        logo={false}
        attribution={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: RWANDA_CENTER,
            zoom: 8,
          }}
          maxBounds={MAX_BOUNDS}
        />

        <GeoJSONSource
          id="sites"
          data={geojson}
          onPress={handlePress}
          hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <Layer
            id="sites-outer"
            type="circle"
            style={outerStyle}
          />
          <Layer
            id="sites-inner"
            type="circle"
            style={innerStyle}
          />
        </GeoJSONSource>
      </Map>

      {selected ? (
        <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <View style={styles.cardRow}>
            <View style={styles.cardMain}>
              <Text style={[styles.cardName, { color: C.ink }]} numberOfLines={1}>
                {selected.name}
              </Text>
              <Text style={[styles.cardSub, { color: C.ink3 }]}>
                {(selected as any).site_code ?? '—'} · {(selected as any).site_type ?? 'School'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setSelectedId(null)}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Text style={[styles.dismiss, { color: C.muted }]}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.metrics, { borderTopColor: C.rule }]}>
            <Metric label="DISHES" value={`${(selected as any).dishes_online ?? 0}/${(selected as any).dishes_total ?? 0}`} color={C.ink2} />
            <Metric label="SCORE" value={(selected as any).score_7day_avg != null ? `${Math.round((selected as any).score_7day_avg)}%` : '—'} color={pinColor((selected as any).score_7day_avg, C)} />
            <Metric label="COMPUTERS" value={String((selected as any).devices_online ?? 0)} color={C.ink2} />
          </View>
        </View>
      ) : (
        <View style={[styles.hint, { backgroundColor: C.surface }]}>
          <Text style={[styles.hintText, { color: C.muted }]}>
            {loading ? 'Loading sites…' : `${sites.length} sites · tap a pin to select`}
          </Text>
        </View>
      )}
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.metricCol}>
      <Text style={[styles.metricVal, { color }]}>{value}</Text>
      <Text style={styles.metricLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map:    { flex: 1 },

  card: {
    position: 'absolute', bottom: 12, left: 12, right: 12,
    borderRadius: 0, borderWidth: 1, overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  cardMain:  { flex: 1 },
  cardName:  { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  cardSub:   { fontSize: 12 },
  dismiss:   { fontSize: 16, paddingLeft: 12 },
  metrics: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  metricCol: { flex: 1, alignItems: 'center' },
  metricVal: { fontSize: 16, fontWeight: '700' },
  metricLbl: { fontSize: 10, color: '#9e9a8b', marginTop: 2, letterSpacing: 0.5 },

  hint: {
    position: 'absolute', bottom: 12, left: 12, right: 12,
    borderRadius: 0, paddingVertical: 12, alignItems: 'center',
  },
  hintText: { fontSize: 13 },
});
