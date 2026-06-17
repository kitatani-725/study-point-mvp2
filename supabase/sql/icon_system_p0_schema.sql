-- icon_system_p0_schema.sql
-- ポイ丸アイコン機能 P0: テーブル作成・users 拡張・初期マスタ seed
--
-- 実行前提:
--   - users テーブルが存在すること
-- 触らないもの:
--   - points / pig_tickets / missions / gift_codes / roulette 関連

-- ============================================================
-- 1. icon_master
-- ============================================================

CREATE TABLE IF NOT EXISTS icon_master (
  icon_key text PRIMARY KEY,
  display_name text NOT NULL,
  asset_path text NOT NULL,
  acquisition_type text NOT NULL,
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  roulette_eligible boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 2. user_icons
-- ============================================================

CREATE TABLE IF NOT EXISTS user_icons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  icon_key text NOT NULL REFERENCES icon_master(icon_key),
  acquired_at timestamptz DEFAULT now(),
  source text NOT NULL,
  source_ref text,
  UNIQUE (user_id, icon_key)
);

CREATE INDEX IF NOT EXISTS user_icons_user_id_idx ON user_icons (user_id);

-- ============================================================
-- 3. users.selected_icon_key
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS selected_icon_key text REFERENCES icon_master(icon_key);

-- ============================================================
-- 4. 初期アイコン 3 件（default_01〜03）
-- ============================================================

INSERT INTO icon_master (icon_key, display_name, asset_path, acquisition_type, sort_order)
VALUES
  ('default_01', 'ポイ丸 1', '/assets/icon/default_01.svg', 'default', 1),
  ('default_04', 'ポイ丸 4', '/assets/icon/default_04.svg', 'default', 2),
  ('default_05', 'ポイ丸 5', '/assets/icon/default_05.svg', 'default', 3)
ON CONFLICT (icon_key) DO NOTHING;
