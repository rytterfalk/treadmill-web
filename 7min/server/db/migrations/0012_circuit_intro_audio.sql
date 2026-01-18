-- Add intro audio support to circuit_programs
ALTER TABLE circuit_programs ADD COLUMN intro_audio_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL;

