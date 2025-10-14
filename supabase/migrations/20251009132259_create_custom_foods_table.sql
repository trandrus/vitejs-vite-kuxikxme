/*
  # Create Custom Foods Table

  1. New Tables
    - `custom_foods`
      - `id` (uuid, primary key)
      - `user_id` (uuid)
      - `name` (text) - Custom food name
      - `amount` (numeric) - Amount in grams
      - `calories` (numeric) - Calories in kcal
      - `fiber` (numeric) - Fiber in grams
      - `protein` (numeric) - Protein in grams
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on custom_foods table
    - Allow all operations for now (no auth yet)

  3. Notes
    - This table stores user-created custom foods
    - Custom foods can be reused across multiple logs
    - Users can define minimal nutritional information
*/

CREATE TABLE IF NOT EXISTS custom_foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 100,
  calories numeric NOT NULL DEFAULT 0,
  fiber numeric NOT NULL DEFAULT 0,
  protein numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE custom_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on custom_foods"
  ON custom_foods
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_custom_foods_user_id ON custom_foods(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_foods_created_at ON custom_foods(created_at DESC);
