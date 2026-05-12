import { useState } from 'react';
import { useSiteNotes, SiteNote } from '@starfleet/shared';

interface Props {
  siteId: number;
  isAdmin: boolean;
  onAddNote: (siteId: number, body: string) => Promise<void>;
  onDeleteNote: (siteId: number, noteId: number) => Promise<void>;
}

export function SiteNotesPanel({ siteId, isAdmin, onAddNote, onDeleteNote }: Props) {
  const { notes, loading, refresh } = useSiteNotes(siteId);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await onAddNote(siteId, draft.trim());
      setDraft('');
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add note.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(noteId: number) {
    if (!confirm('Delete this note?')) return;
    try {
      await onDeleteNote(siteId, noteId);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete note.');
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)' }}>
        <strong style={{ fontSize: 13 }}>Operational Notes</strong>
      </div>

      {loading && <div className="muted" style={{ padding: '10px 16px', fontSize: 12 }}>Loading…</div>}

      {!loading && notes.length === 0 && (
        <div className="muted" style={{ padding: '10px 16px', fontSize: 12 }}>No notes yet.</div>
      )}

      {notes.map(note => (
        <NoteRow key={note.id} note={note} isAdmin={isAdmin} onDelete={handleDelete} />
      ))}

      {isAdmin && (
        <form onSubmit={handleSubmit} style={{ padding: '10px 16px', borderTop: notes.length ? '1px solid var(--rule)' : undefined }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a note… (maintenance, outage, observation)"
            rows={2}
            maxLength={10000}
            style={{
              width: '100%', boxSizing: 'border-box', fontSize: 12,
              padding: '6px 8px', borderRadius: 4, border: '1px solid var(--rule)',
              background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical',
            }}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !draft.trim()}
            style={{ marginTop: 6, fontSize: 12 }}
          >
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </form>
      )}
    </div>
  );
}

function NoteRow({
  note,
  isAdmin,
  onDelete,
}: {
  note: SiteNote;
  isAdmin: boolean;
  onDelete: (id: number) => void;
}) {
  const ts = new Date(note.created_at);
  const ago = relativeTime(ts);

  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: '1px solid var(--rule)',
      display: 'flex',
      gap: 8,
      alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
          {note.author} · {ago}
        </div>
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {note.body}
        </div>
      </div>
      {isAdmin && (
        <button
          onClick={() => onDelete(note.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', fontSize: 14, padding: '0 2px', flexShrink: 0,
          }}
          title="Delete note"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function relativeTime(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return date.toLocaleDateString();
}
