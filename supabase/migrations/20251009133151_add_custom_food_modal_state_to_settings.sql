/*
  # Add Custom Food Modal State to User Settings

  1. Changes
    - Add `custom_food_modal_open` boolean column to track if modal is open
    - Add `custom_food_draft` jsonb column to store draft custom food data

  2. Notes
    - This allows the custom food modal state to persist across page refreshes
    - The draft data includes name, amount, calories, fiber, and protein values
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'custom_food_modal_open'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN custom_food_modal_open boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'custom_food_draft'
  ) THEN
    ALTER TABLE user_settings ADD COLUMN custom_food_draft jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;
