/*
  # Create Food Tracker Tables

  1. New Tables
    - `user_settings`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, nullable for now since no auth yet)
      - `fdc_api_key` (text) - USDA FoodData Central API key
      - `search_results` (jsonb) - Cached search results
      - `updated_at` (timestamptz)
      
    - `food_log`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, nullable for now)
      - `name` (text) - Food name
      - `amount` (numeric) - Amount in grams
      - `favorite` (boolean) - Whether this food is favorited
      - `base_per_g` (jsonb) - Nutritional data per gram
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - For now, allow all operations since there's no auth yet
    - Policies can be restricted later when auth is added

  3. Notes
    - Using nullable user_id to support current non-auth implementation
    - Will use a default user_id for now until auth is implemented
*/

-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  fdc_api_key text DEFAULT '',
  search_results jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Create food_log table
CREATE TABLE IF NOT EXISTS food_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  favorite boolean DEFAULT false,
  base_per_g jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_log ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for now (no auth)
CREATE POLICY "Allow all operations on user_settings"
  ON user_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on food_log"
  ON food_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_food_log_user_id ON food_log(user_id);
CREATE INDEX IF NOT EXISTS idx_food_log_favorite ON food_log(favorite);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);