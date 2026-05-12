import { useState } from 'react';
import { useBiweeklyUsage, SiteBiweeklyUsage } from '@starfleet/shared';

interface Props {
  siteId: number;
  isAdmin: boolean;
  onAddEntry: (
    siteId: number,
    entry: { period_start: string; period_end: string; gb_down?: number; gb_up?: number; notes?: string },
  ) => Promise<void>;
  onDeleteEntry: (siteId: number, entryId: number) => Promise<void>;
}

function defaultPeriodEnd(start: string): string {
  if (!start) return '';
  const d = new Date(start);
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function bytesToGb(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(2);
}

export function BiweeklyUsagePanel({ siteId, isAdmin, onAddEntry, onDeleteEntry }: Props) {
  const { entries, loading, refresh } = useBiweeklyUsage(siteId);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm] = useState({
    period_start: '',
    period_end: '',
    gb_down: '',
    gb_up: '',
    notes: '',
  });

  function handleStartChange(v: string) {
    setForm(f => ({ ...f, period_start: v, period_end: defaultPeriodEnd(v) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { period_start, period_end, gb_down, gb_up, notes } = form;
    if (!period_start || !period_end) {
      alert('Period start and end are required.');
      return;
    }
    if (!gb_down && !gb_up) {
      alert('Provide at least one of GB down or GB up.');
      return;
    }
    setSaving(true);
    try {
      await onAddEntry(siteId, {
        period_start,
        period_end,
        gb_down: gb_down ? Number(gb_down) : undefined,
        gb_up:   gb_up   ? Number(gb_up)   : undefined,
        notes:   notes   || undefined,
      });
      setForm({ period_start: '', period_end: '', gb_down: '', gb_up: '', notes: '' });
      setShowForm(false);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save entry.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entryId: number) {
    if (!confirm('Delete this usage entry?')) return;
    try {
      await onDeleteEntry(siteId, entryId);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete entry.');
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--rule)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <strong style={{ fontSize: 13, flex: 1 }}>Data Usage (bi-weekly)</strong>
        {isAdmin && (
          <button
            className="btn"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => setShowForm(v => !v)}
          >
            {showForm ? 'Cancel' : '+ Add entry'}
          </button>
        )}
      </div>

      {loading && <div className="muted" style={{ padding: '10px 16px', fontSize: 12 }}>Loading…</div>}

      {!loading && entries.length === 0 && !showForm && (
        <div className="muted" style={{ padding: '10px 16px', fontSize: 12 }}>No usage entries yet.</div>
      )}

      {showForm && isAdmin && (
        <form onSubmit={handleSubmit} style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ fontSize: 11 }}>
              Period start
              <input
                type="date"
                required
                value={form.period_start}
                onChange={e => handleStartChange(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              Period end
              <input
                type="date"
                required
                value={form.period_end}
                min={form.period_start}
                onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              GB download
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.gb_down}
                onChange={e => setForm(f => ({ ...f, gb_down: e.target.value }))}
                placeholder="e.g. 32.5"
                style={inputStyle}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              GB upload
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.gb_up}
                onChange={e => setForm(f => ({ ...f, gb_up: e.target.value }))}
                placeholder="e.g. 4.2"
                style={inputStyle}
              />
            </label>
          </div>
          <label style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
            Notes (optional)
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Mid-month read from Starlink portal"
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving}
            style={{ marginTop: 8, fontSize: 12 }}
          >
            {saving ? 'Saving…' : 'Save entry'}
          </button>
        </form>
      )}

      {entries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule)' }}>
              <th style={thStyle}>Period</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>↓ GB</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>↑ GB</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
              <th style={thStyle}>Notes</th>
              <th style={thStyle}>By</th>
              {isAdmin && <th style={thStyle} />}
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <UsageRow
                key={entry.id}
                entry={entry}
                isAdmin={isAdmin}
                onDelete={handleDelete}
                bytesToGb={bytesToGb}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UsageRow({
  entry,
  isAdmin,
  onDelete,
  bytesToGb,
}: {
  entry: SiteBiweeklyUsage;
  isAdmin: boolean;
  onDelete: (id: number) => void;
  bytesToGb: (b: number) => string;
}) {
  const total = entry.bytes_down + entry.bytes_up;
  return (
    <tr style={{ borderBottom: '1px solid var(--rule)' }}>
      <td style={tdStyle}>
        {entry.period_start} – {entry.period_end}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {bytesToGb(entry.bytes_down)}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {bytesToGb(entry.bytes_up)}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {bytesToGb(total)}
      </td>
      <td style={{ ...tdStyle, color: 'var(--muted)' }}>{entry.notes ?? '—'}</td>
      <td style={{ ...tdStyle, color: 'var(--muted)' }}>{entry.entered_by}</td>
      {isAdmin && (
        <td style={tdStyle}>
          <button
            onClick={() => onDelete(entry.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--muted)', fontSize: 13, padding: '0 2px',
            }}
            title="Delete entry"
          >
            ✕
          </button>
        </td>
      )}
    </tr>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 3,
  padding: '4px 6px', fontSize: 12, borderRadius: 4,
  border: '1px solid var(--rule)',
  background: 'var(--surface)', color: 'var(--ink)',
  boxSizing: 'border-box',
};

const thStyle: React.CSSProperties = {
  padding: '6px 12px', textAlign: 'left', fontWeight: 500,
  color: 'var(--muted)', fontSize: 11,
};

const tdStyle: React.CSSProperties = {
  padding: '7px 12px',
};
