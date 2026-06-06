import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, useColorScheme,
} from 'react-native';
import { useSite } from '@starfleet/shared';
import type { UpdateSiteInput } from '@starfleet/shared';
import { SiteEditProps } from '../navigation/types';
import { getApi } from '../store/auth';
import { light, dark, Colors } from '../theme/colors';

export function SiteEditScreen({ route, navigation }: SiteEditProps) {
  const { siteId } = route.params;
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const { site, loading } = useSite(siteId);

  const [form, setForm] = useState({
    name:          '',
    location:      '',
    district:      '',
    lat:           '',
    lng:           '',
    starlink_sn:   '',
    kit_id:        '',
    starlink_uuid: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (site) {
      setForm({
        name:          site.name,
        location:      site.location      ?? '',
        district:      site.district      ?? '',
        lat:           site.lat           != null ? String(site.lat) : '',
        lng:           site.lng           != null ? String(site.lng) : '',
        starlink_sn:   site.starlink_sn,
        kit_id:        site.kit_id        ?? '',
        starlink_uuid: site.starlink_uuid ?? '',
      });
    }
  }, [site?.id]);

  function set(key: keyof typeof form) {
    return (v: string) => setForm(f => ({ ...f, [key]: v }));
  }

  async function handleSave() {
    if (!form.name.trim()) { Alert.alert('Error', 'Name is required.'); return; }
    if (!form.starlink_sn.trim()) { Alert.alert('Error', 'Starlink SN is required.'); return; }
    if (form.lat && (isNaN(Number(form.lat)) || Math.abs(Number(form.lat)) > 90)) {
      Alert.alert('Error', 'Latitude must be between -90 and 90.'); return;
    }
    if (form.lng && (isNaN(Number(form.lng)) || Math.abs(Number(form.lng)) > 180)) {
      Alert.alert('Error', 'Longitude must be between -180 and 180.'); return;
    }

    const input: UpdateSiteInput = {
      name:          form.name.trim(),
      starlink_sn:   form.starlink_sn.trim(),
      location:      form.location.trim()      || null,
      district:      form.district.trim()      || null,
      lat:           form.lat  ? Number(form.lat)  : null,
      lng:           form.lng  ? Number(form.lng)  : null,
      kit_id:        form.kit_id.trim()        || null,
      starlink_uuid: form.starlink_uuid.trim() || null,
    };

    const api = getApi();
    if (!api) return;
    setSaving(true);
    try {
      await api.updateSite(siteId, input);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !site) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.bg }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <FormField label="Name *"        value={form.name}          onChangeText={set('name')}          C={C} />
      <FormField label="Starlink SN *" value={form.starlink_sn}   onChangeText={set('starlink_sn')}   C={C} />
      <FormField label="Location"      value={form.location}       onChangeText={set('location')}      C={C} />
      <FormField label="District"      value={form.district}       onChangeText={set('district')}      C={C} />
      <FormField label="Latitude"      value={form.lat}            onChangeText={set('lat')}           C={C} keyboardType="decimal-pad" />
      <FormField label="Longitude"     value={form.lng}            onChangeText={set('lng')}           C={C} keyboardType="decimal-pad" />
      <FormField label="Kit ID"        value={form.kit_id}         onChangeText={set('kit_id')}        C={C} />
      <FormField label="Starlink UUID" value={form.starlink_uuid}  onChangeText={set('starlink_uuid')} C={C} />

      <TouchableOpacity
        style={[styles.saveBtn, { backgroundColor: C.accent, opacity: saving ? 0.5 : 1 }]}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={[styles.saveBtnText, { color: C.bg }]}>{saving ? 'Saving…' : 'Save changes'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function FormField({
  label, value, onChangeText, C, keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  C: Colors;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 12, color: C.muted, marginBottom: 4, fontWeight: '500' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={[styles.input, { color: C.ink, borderColor: C.rule, backgroundColor: C.surface }]}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:      { flex: 1 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  input:       { borderWidth: 1, borderRadius: 0, padding: 10, fontSize: 14 },
  saveBtn:     { borderRadius: 0, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  saveBtnText: { fontWeight: '600', fontSize: 15 },
});
