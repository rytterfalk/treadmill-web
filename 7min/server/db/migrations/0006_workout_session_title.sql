-- Add hiit_program_title column to store the name of HIIT workouts
-- This allows showing the program name in history without complex joins

ALTER TABLE workout_sessions ADD COLUMN hiit_program_title TEXT;

