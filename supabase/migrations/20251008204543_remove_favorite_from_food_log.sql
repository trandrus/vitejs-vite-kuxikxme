/*
  # Remove favorite column from food_log

  1. Changes
    - Drop the `favorite` column from `food_log` table
    - This column is no longer needed as favorites are now tracked in a separate table

  2. Notes
    - The favorites table now stores favorite foods independently
    - Favorites persist even when foods are removed from the log
*/

-- Remove favorite column from food_log
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'food_log' AND column_name = 'favorite'
  ) THEN
    ALTER TABLE food_log DROP COLUMN favorite;
  END IF;
END $$;
