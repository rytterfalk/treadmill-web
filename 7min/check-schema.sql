-- Quick schema verification queries
-- Run with: sqlite3 server/db/app.db < check-schema.sql

.mode column
.headers on

SELECT '=== CIRCUIT_PROGRAMS TABLE STRUCTURE ===' AS '';
PRAGMA table_info(circuit_programs);

SELECT '' AS '';
SELECT '=== CIRCUIT_EXERCISES TABLE STRUCTURE ===' AS '';
PRAGMA table_info(circuit_exercises);

SELECT '' AS '';
SELECT '=== MEDIA_ASSETS TABLE STRUCTURE ===' AS '';
PRAGMA table_info(media_assets);

SELECT '' AS '';
SELECT '=== CIRCUIT PROGRAMS WITH AUDIO ===' AS '';
SELECT 
  id,
  title,
  intro_audio_asset_id,
  (SELECT COUNT(*) FROM circuit_exercises WHERE circuit_program_id = circuit_programs.id) as exercise_count
FROM circuit_programs
LIMIT 5;

SELECT '' AS '';
SELECT '=== CIRCUIT EXERCISES WITH AUDIO ===' AS '';
SELECT 
  ce.id,
  ce.title,
  ce.audio_asset_id,
  ce.rest_audio_asset_id,
  cp.title as program_title
FROM circuit_exercises ce
JOIN circuit_programs cp ON cp.id = ce.circuit_program_id
WHERE ce.audio_asset_id IS NOT NULL OR ce.rest_audio_asset_id IS NOT NULL
LIMIT 5;

SELECT '' AS '';
SELECT '=== AUDIO ASSETS ===' AS '';
SELECT id, filename, type, created_at
FROM media_assets
WHERE type = 'audio'
ORDER BY created_at DESC
LIMIT 5;

