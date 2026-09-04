CREATE TABLE IF NOT EXISTS site_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  portal_title text NOT NULL DEFAULT 'Test your knowledge. Claim your rank.',
  subtitle text NOT NULL DEFAULT 'Online Examination Portal',
  description text NOT NULL DEFAULT '40 questions. 40 minutes. Take the timed exam and check your results as soon as they are published.',
  contact_numbers text NOT NULL DEFAULT '',
  poster_url text NOT NULL DEFAULT '/ChatGPT_Image_Sep_3,_2026,_08_13_21_AM.png',
  primary_color text NOT NULL DEFAULT '#1c4f9d',
  background_color text NOT NULL DEFAULT '#171918',
  card_color text NOT NULL DEFAULT '#2b312c',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_site_settings" ON site_settings;
CREATE POLICY "public_read_site_settings" ON site_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "admin_insert_site_settings" ON site_settings;
CREATE POLICY "admin_insert_site_settings" ON site_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "admin_update_site_settings" ON site_settings;
CREATE POLICY "admin_update_site_settings" ON site_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS site_settings_updated_at ON site_settings;
CREATE TRIGGER site_settings_updated_at BEFORE UPDATE ON site_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();