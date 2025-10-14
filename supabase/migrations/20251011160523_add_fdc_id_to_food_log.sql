/*
  # Add FDC ID to Food Log

  1. Changes
    - Add `fdc_id` column to food_log table to store the USDA FDC ID
    - Add `custom_food_id` column to reference custom foods
    - This allows proper tracking of favorites for food log items

  2. Notes
    - Existing food log items will have NULL fdc_id and custom_food_id
    - New items will store the appropriate ID
    - At least one of fdc_id or custom_food_id should be set, or both can be NULL for legacy items
*/

-- Add fdc_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'food_log' AND column_name = 'fdc_id'
  ) THEN
    ALTER TABLE food_log ADD COLUMN fdc_id integer;
  END IF;
END $$;

-- Add custom_food_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'food_log' AND column_name = 'custom_food_id'
  ) THEN
    ALTER TABLE food_log ADD COLUMN custom_food_id uuid REFERENCES custom_foods(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_food_log_fdc_id ON food_log(fdc_id);
CREATE INDEX IF NOT EXISTS idx_food_log_custom_food_id ON food_log(custom_food_id);
