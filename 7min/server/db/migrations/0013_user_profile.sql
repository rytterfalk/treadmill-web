-- Add profile fields to users for calorie calculations
-- weight_kg is required for accurate kcal estimation
-- Other fields are optional for future advanced models

ALTER TABLE users ADD COLUMN weight_kg REAL;
ALTER TABLE users ADD COLUMN height_cm REAL;
ALTER TABLE users ADD COLUMN birth_year INTEGER;
ALTER TABLE users ADD COLUMN sex TEXT CHECK (sex IN ('male', 'female', 'other'));

