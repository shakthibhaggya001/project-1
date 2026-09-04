ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS motivational_banner_url text NOT NULL DEFAULT '';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS motivational_quote text NOT NULL DEFAULT '';
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS show_motivational_banner boolean NOT NULL DEFAULT true;
