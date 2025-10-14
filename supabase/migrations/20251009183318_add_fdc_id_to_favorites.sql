/*
  # Add FDC ID to Favorites Table

  1. Changes
    - Add `fdc_id` column to favorites table to store the USDA FDC ID
    - This allows us to fetch the exact food item instead of searching by name
    - For custom foods, fdc_id will be NULL

  2. Notes
    - Existing favorites will have NULL fdc_id (will still work with name search)
    - New favorites will store both name and fdc_id for accurate retrieval
*/

-- Add fdc_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'favorites' AND column_name = 'fdc_id'
  ) THEN
    ALTER TABLE favorites ADD COLUMN fdc_id integer;
  END IF;
END $$;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_favorites_fdc_id ON favorites(fdc_id);
