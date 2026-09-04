import { ChangeEvent, useEffect, useState } from 'react';
import { ArrowLeft, Image as ImageIcon, Loader2, Save } from 'lucide-react';
import { defaultSiteSettings } from '@/lib/supabase';
import { useSiteSettings } from '@/lib/siteSettings';

type Props = { onBack: () => void };

export default function SiteSettings({ onBack }: Props) {
  const { settings, loading, saveSettings } = useSiteSettings();
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!loading) setForm(settings);
  }, [loading, settings]);

  const update = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update('poster_url', String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleMotivationalFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update('motivational_banner_url', String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    const error = await saveSettings(form);
    setSaving(false);
    setMessage(error ? `Settings were not saved: ${error}` : 'Settings saved. The customer view will use them immediately.');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4" /> Dashboard</button>
          <h1 className="text-xl font-bold text-slate-900">Site Settings</h1>
          <button onClick={save} disabled={saving} className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl"><Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Settings'}</button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Content & Text</h2>
            <Field label="Portal Title" value={form.portal_title} onChange={(value) => update('portal_title', value)} />
            <Field label="Subtitle" value={form.subtitle} onChange={(value) => update('subtitle', value)} />
            <Field label="Description" value={form.description} onChange={(value) => update('description', value)} area />
            <Field label="Contact Numbers" value={form.contact_numbers} onChange={(value) => update('contact_numbers', value)} placeholder="e.g. 077 123 4567" />
          </section>
          <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Poster</h2>
            <Field label="Image URL" value={form.poster_url.startsWith('data:') ? '' : form.poster_url} onChange={(value) => update('poster_url', value)} placeholder="https://..." />
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><ImageIcon className="w-4 h-4" /> Or upload an image<input type="file" accept="image/*" onChange={handleFile} className="text-sm" /></label>
          </section>
          <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div><h2 className="text-lg font-bold text-slate-900">Motivational Banner</h2><p className="text-sm text-slate-500">Show an optional image or notice below the hero actions.</p></div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={form.show_motivational_banner} onChange={(event) => update('show_motivational_banner', event.target.checked)} className="h-4 w-4 accent-blue-600" /> Show</label>
            </div>
            <Field label="Motivational Banner/Sticker Image URL" value={form.motivational_banner_url.startsWith('data:') ? '' : form.motivational_banner_url} onChange={(value) => update('motivational_banner_url', value)} placeholder="https://..." />
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><ImageIcon className="w-4 h-4" /> Or upload an image<input type="file" accept="image/*" onChange={handleMotivationalFile} className="text-sm" /></label>
            <Field label="Motivational Quote / Notice Text" value={form.motivational_quote} onChange={(value) => update('motivational_quote', value)} placeholder="Keep learning, keep rising." area />
          </section>
          <section className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Theme Colors</h2>
            <div className="grid gap-4 sm:grid-cols-3"><ColorField label="Primary Accent" value={form.primary_color} onChange={(value) => update('primary_color', value)} /><ColorField label="Background" value={form.background_color} onChange={(value) => update('background_color', value)} /><ColorField label="Card Color" value={form.card_color} onChange={(value) => update('card_color', value)} /></div>
          </section>
          {message && <p className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-4 py-3">{message}</p>}
        </div>
        <aside className="lg:sticky lg:top-6 h-fit rounded-2xl p-3 text-white" style={{ backgroundColor: form.background_color }}>
          <p className="text-xs uppercase tracking-widest opacity-70 px-2 py-2">Live Preview</p>
          <img src={form.poster_url || defaultSiteSettings.poster_url} alt="Poster preview" className="w-full aspect-[4/5] object-cover rounded-xl" />
          <div className="mt-3 rounded-xl p-4" style={{ backgroundColor: form.card_color }}><p className="text-xs uppercase tracking-widest" style={{ color: form.primary_color }}>{form.subtitle}</p><h3 className="text-xl font-bold mt-2">{form.portal_title}</h3><p className="text-sm mt-2 opacity-75">{form.description}</p></div>
          {form.show_motivational_banner && (form.motivational_banner_url || form.motivational_quote) && <div className="mt-3 overflow-hidden rounded-xl border border-white/10">{form.motivational_banner_url && <img src={form.motivational_banner_url} alt="Motivational preview" className="max-h-28 w-full object-cover" />}{form.motivational_quote && <p className="px-3 py-2 text-center text-sm italic">{form.motivational_quote}</p>}</div>}
        </aside>
      </main>
    </div>
  );
}

function Field({ label, value, onChange, area, placeholder }: { label: string; value: string; onChange: (value: string) => void; area?: boolean; placeholder?: string }) {
  const className = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900 outline-none focus:border-blue-500";
  return <label className="block text-sm font-medium text-slate-700">{label}{area ? <textarea rows={4} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={`${className} mt-1.5`} /> : <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={`${className} mt-1.5`} />}</label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<div className="mt-1.5 flex items-center gap-2"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 cursor-pointer rounded-lg border-0 p-0" /><input value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div></label>;
}