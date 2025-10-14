/*
  # Create Favorites Table

  1. New Tables
    - `favorites`
      - `id` (uuid, primary key)
      - `user_id` (uuid)
      - `food_name` (text) - Normalized food name for matching
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on favorites table
    - Allow all operations for now (no auth yet)

  3. Notes
    - This table stores favorite foods separately from the food log
    - When a food is removed from the log, it remains favorited
    - Using lowercase normalized food names for matching
*/

-- Create favorites table
CREATE TABLE IF NOT EXISTS favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  food_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, food_name)
);

-- Enable RLS
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- Create permissive policy for now (no auth)
CREATE POLICY "Allow all operations on favorites"
  ON favorites
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_food_name ON favorites(food_name);
