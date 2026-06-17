-- icon_system_p4_mission_icon_lifetime.sql
-- P4: 累計ログイン31/101/366日 アイコン報酬ミッション追加
--
-- 実行前提:
--   - icon_system_p0_schema.sql 実行済み
--   - icon_system_p4_mission_icon_reward.sql 実行済み（missions.reward_icon_key）
-- 触らないもの:
--   - 既存 lifetime_login_30 / 100 / 365 等のポイント報酬ミッション
--   - points / pig_tickets / gift_codes / roulette 関連

-- ============================================================
-- 1. icon_master（ミッション報酬アイコン）
-- ============================================================

INSERT INTO icon_master (icon_key, display_name, asset_path, acquisition_type, sort_order, is_active)
VALUES
  ('mission_30', '累計ログイン31日', '/assets/icon/mission_30.svg', 'mission', 110, true),
  ('mission_100', '累計ログイン101日', '/assets/icon/mission_100.svg', 'mission', 111, true),
  ('mission_365', '累計ログイン366日', '/assets/icon/mission_365.svg', 'mission', 112, true)
ON CONFLICT (icon_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  asset_path = EXCLUDED.asset_path,
  acquisition_type = EXCLUDED.acquisition_type,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- ============================================================
-- 2. missions（新規3件のみ追加・既存は変更しない）
-- ============================================================

INSERT INTO missions (
  category,
  mission_key,
  title,
  target_value,
  reward_type,
  reward_amount,
  reward_icon_key,
  sort_order,
  is_active
)
SELECT
  v.category,
  v.mission_key,
  v.title,
  v.target_value,
  v.reward_type,
  v.reward_amount,
  v.reward_icon_key,
  v.sort_order,
  v.is_active
FROM (
  VALUES
    (
      'lifetime'::text,
      'lifetime_login_31'::text,
      '累計ログイン31日'::text,
      31::int,
      'icon'::text,
      0::int,
      'mission_30'::text,
      31::int,
      true::boolean
    ),
    (
      'lifetime'::text,
      'lifetime_login_101'::text,
      '累計ログイン101日'::text,
      101::int,
      'icon'::text,
      0::int,
      'mission_100'::text,
      101::int,
      true::boolean
    ),
    (
      'lifetime'::text,
      'lifetime_login_366'::text,
      '累計ログイン366日'::text,
      366::int,
      'icon'::text,
      0::int,
      'mission_365'::text,
      366::int,
      true::boolean
    )
) AS v(category, mission_key, title, target_value, reward_type, reward_amount, reward_icon_key, sort_order, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM missions m WHERE m.mission_key = v.mission_key
);

-- ============================================================
-- 3. 確認
-- ============================================================

SELECT icon_key, display_name, asset_path, acquisition_type, is_active
FROM icon_master
WHERE icon_key IN ('mission_30', 'mission_100', 'mission_365')
ORDER BY sort_order;

SELECT mission_key, category, title, target_value, reward_type, reward_amount, reward_icon_key, sort_order, is_active
FROM missions
WHERE mission_key IN ('lifetime_login_31', 'lifetime_login_101', 'lifetime_login_366')
ORDER BY target_value;
