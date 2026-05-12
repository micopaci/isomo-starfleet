import { useState, useEffect } from 'react';
import type { Site, UpdateSiteInput } from '@starfleet/shared';

interface Props {
  site: Site;
  onSave: (id: number, input: UpdateSiteInput) => Promise<void>;
  onClose: () => void;
}

export function SiteEditModal({ site, onSave, onClose }: Props) {
  const [form, setForm] = useState({
    name:          site.name,
    location:      site.location      ?? '',
    district:      site.district      ?? '',
    lat:           site.lat           != null ? String(site.lat) : '',
    lng:           site.lng           != null ? String(site.lng) : '',
    starlink_sn:   site.starlink_sn,
    kit_id:        site.kit_id        ?? '',
    starlink_uuid: site.starlink_uuid ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Reset when site changes
  useEffect(() => {
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
  }, [site.id]);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.starlink_sn.trim()) { setError('Starlink SN is required.'); return; }
    if (form.lat && (isNaN(Number(form.lat)) || Math.abs(Number(form.lat)) > 90)) {
      setError('Latitude must be between -90 and 90.'); return;
    }
    if (form.lng && (isNaN(Number(form.lng)) || Math.abs(Number(form.lng)) > 180)) {
      setError('Longitude must be between -180 and 180.'); return;
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

    setSaving(true);
    try {
      await onSave(site.id, input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialog}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8 }}>
          <h2 style={{ flex: 1, margin: 0, fontSize: 16 }}>Edit site — {site.name}</h2>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={grid}>
            <Field label="Name *"       value={form.name}          onChange={set('name')} />
            <Field label="Starlink SN *" value={form.starlink_sn}  onChange={set('starlink_sn')} />
            <Field label="Location"      value={form.location}      onChange={set('location')} />
            <Field label="District"      value={form.district}      onChange={set('district')} />
            <Field label="Latitude"      value={form.lat}           onChange={set('lat')}  type="number" step="0.000001" />
            <Field label="Longitude"     value={form.lng}           onChange={set('lng')}  type="number" step="0.000001" />
            <Field label="Kit ID"        value={form.kit_id}        onChange={set('kit_id')} />
            <Field label="Starlink UUID" value={form.starlink_uuid} onChange={set('starlink_uuid')} />
          </div>

          {error && (
            <div style={{ color: 'var(--bad)', fontSize: 12, marginBottom: 10 }}>{error}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', step,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  step?: string;
}) {
  return (
    <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={onChange}
        style={{
          padding: '5px 8px', fontSize: 12, borderRadius: 4,
          border: '1px solid var(--rule)',
          background: 'var(--surface)', color: 'var(--ink)',
        }}
      />
    </label>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
};

const dialog: React.CSSProperties = {
  background: 'var(--surface)', borderRadius: 10, padding: 24,
  width: 480, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
};

const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
};

const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--muted)', fontSize: 16, padding: '0 4px',
};
