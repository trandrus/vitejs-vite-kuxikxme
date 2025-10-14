/*
  # Update Favorites Table Unique Constraint

  1. Changes
    - Drop the old unique constraint on (user_id, food_name)
    - Add custom_food_id column to reference custom foods
    - Add new unique constraint on (user_id, fdc_id) for USDA foods
    - Add new unique constraint on (user_id, custom_food_id) for custom foods
    - This allows multiple favorites with the same name but different fdc_ids

  2. Notes
    - Each USDA food with a unique fdc_id can be favorited separately
    - Each custom food with a unique custom_food_id can be favorited separately
    - The food_name column remains for display purposes
*/

-- Add custom_food_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'favorites' AND column_name = 'custom_food_id'
  ) THEN
    ALTER TABLE favorites ADD COLUMN custom_food_id uuid REFERENCES custom_foods(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Drop old unique constraint
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_user_id_food_name_key;

-- Create new unique constraints
-- For USDA foods: unique on (user_id, fdc_id) where fdc_id is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_user_fdc 
  ON favorites(user_id, fdc_id) 
  WHERE fdc_id IS NOT NULL;

-- For custom foods: unique on (user_id, custom_food_id) where custom_food_id is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_user_custom 
  ON favorites(user_id, custom_food_id) 
  WHERE custom_food_id IS NOT NULL;

-- Add check constraint to ensure either fdc_id or custom_food_id is set
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS check_favorites_has_id;
ALTER TABLE favorites ADD CONSTRAINT check_favorites_has_id 
  CHECK (
    (fdc_id IS NOT NULL AND custom_food_id IS NULL) OR 
    (fdc_id IS NULL AND custom_food_id IS NOT NULL)
  );

-- Create index for custom_food_id lookups
CREATE INDEX IF NOT EXISTS idx_favorites_custom_food_id ON favorites(custom_food_id);
