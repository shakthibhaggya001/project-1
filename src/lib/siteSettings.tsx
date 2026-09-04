import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  defaultSiteSettings,
  loadSiteSettings,
  saveSiteSettings as persistSiteSettings,
  type SiteSettings,
} from './supabase';

type EditableSiteSettings = Omit<SiteSettings, 'id' | 'updated_at'>;

type SiteSettingsContextValue = {
  settings: EditableSiteSettings;
  loading: boolean;
  saveSettings: (settings: EditableSiteSettings) => Promise<string | null>;
};

const SiteSettingsContext = createContext<SiteSettingsContextValue | undefined>(undefined);

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<EditableSiteSettings>(defaultSiteSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSiteSettings().then(({ settings: loadedSettings }) => {
      setSettings(loadedSettings);
      setLoading(false);
    });
  }, []);

  const saveSettings = async (nextSettings: EditableSiteSettings) => {
    setSettings(nextSettings);
    const error = await persistSiteSettings(nextSettings);
    return error?.message ?? null;
  };

  return (
    <SiteSettingsContext.Provider value={{ settings, loading, saveSettings }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  const context = useContext(SiteSettingsContext);
  if (!context) throw new Error('useSiteSettings must be used within SiteSettingsProvider');
  return context;
}