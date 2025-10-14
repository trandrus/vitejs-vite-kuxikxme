/*
  # Add total_results column to user_settings

  1. Changes
    - Add `total_results` (integer) column to `user_settings` table
    - This stores the total hit count from search API for pagination
  
  2. Notes
    - Default value is 0 to match initial state
    - Allows pagination to persist across page refreshes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'total_results'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN total_results integer DEFAULT 0;
  END IF;
END $$;