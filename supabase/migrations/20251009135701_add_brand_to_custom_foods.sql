/*
  # Add Brand Field to Custom Foods

  1. Changes
    - Add `brand` text column to custom_foods table

  2. Notes
    - Allows users to specify brand/source for custom foods
    - Optional field with empty string as default
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_foods' AND column_name = 'brand'
  ) THEN
    ALTER TABLE custom_foods ADD COLUMN brand text DEFAULT '';
  END IF;
END $$;
