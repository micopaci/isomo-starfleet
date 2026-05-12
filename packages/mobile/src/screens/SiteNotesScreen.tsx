import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, useColorScheme,
} from 'react-native';
import { useSiteNotes } from '@starfleet/shared';
import { SiteNotesProps } from '../navigation/types';
import { getApi, getToken, decodeJwtPayload } from '../store/auth';
import { light, dark, Colors } from '../theme/colors';

export function SiteNotesScreen({ route }: SiteNotesProps) {
  const { siteId } = route.params;
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const { notes, loading, refresh } = useSiteNotes(siteId);

  const token   = getToken();
  const isAdmin = token ? (decodeJwtPayload(token) as any)?.role === 'admin' : false;

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!draft.trim()) return;
    const api = getApi();
    if (!api) return;
    setSaving(true);
    try {
      await api.addSiteNote(siteId, draft.trim());
      setDraft('');
      refresh();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to add note.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(noteId: number) {
    Alert.alert('Delete note', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const api = getApi();
          if (!api) return;
          try {
            await api.deleteSiteNote(siteId, noteId);
            refresh();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete.');
          }
        },
      },
    ]);
  }

  if (loading && !notes.length) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.bg }]}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      {notes.length === 0 && (
        <Text style={[styles.empty, { color: C.muted }]}>No notes yet.</Text>
      )}

      {notes.map(note => (
        <View key={note.id} style={[styles.noteCard, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <View style={styles.noteMeta}>
            <Text style={[styles.noteAuthor, { color: C.muted }]}>
              {note.author} · {relativeTime(new Date(note.created_at))}
            </Text>
            {isAdmin && (
              <TouchableOpacity onPress={() => handleDelete(note.id)} hitSlop={8}>
                <Text style={{ color: C.muted, fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.noteBody, { color: C.ink }]}>{note.body}</Text>
        </View>
      ))}

      {isAdmin && (
        <View style={[styles.addCard, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a note…"
            placeholderTextColor={C.muted}
            multiline
            numberOfLines={3}
            maxLength={10000}
            style={[styles.input, { color: C.ink, borderColor: C.rule }]}
          />
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: C.accent, opacity: saving || !draft.trim() ? 0.5 : 1 }]}
            onPress={handleAdd}
            disabled={saving || !draft.trim()}
          >
            <Text style={styles.addBtnText}>{saving ? 'Saving…' : 'Add note'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function relativeTime(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return date.toLocaleDateString();
}

const styles = StyleSheet.create({
  screen:      { flex: 1 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:       { fontSize: 14, textAlign: 'center', marginTop: 32 },
  noteCard:    { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10 },
  noteMeta:    { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  noteAuthor:  { flex: 1, fontSize: 11 },
  noteBody:    { fontSize: 14, lineHeight: 20 },
  addCard:     { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 8 },
  input:       { borderWidth: 1, borderRadius: 6, padding: 8, fontSize: 14,
                 minHeight: 72, textAlignVertical: 'top', marginBottom: 10 },
  addBtn:      { borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  addBtnText:  { color: '#fff', fontWeight: '600', fontSize: 14 },
});
