/*
  # Add Selected Energy to User Settings

  1. Changes
    - Add `selected_energy` text column to track which energy profile is selected
    - Valid values: 'bmr', 'tdee', 'target', or null

  2. Notes
    - This allows the energy selection to persist across page refreshes
    - When null, no energy profile is selected
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'selected_energy'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN selected_energy text DEFAULT NULL;
  END IF;
END $$;