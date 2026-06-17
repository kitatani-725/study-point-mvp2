-- icon_system_swap_default_icons.sql
-- 初期デフォルトを default_01 / default_04 / default_05 に差し替え（02・03 は非アクティブ化）
-- 実行前提: icon_system_p0_schema.sql 実行済み

-- 1. 新マスタ追加・旧 default_02/03 を非アクティブ化
INSERT INTO icon_master (icon_key, display_name, asset_path, acquisition_type, sort_order)
VALUES
  ('default_04', 'ポイ丸 4', '/assets/icon/default_04.svg', 'default', 2),
  ('default_05', 'ポイ丸 5', '/assets/icon/default_05.svg', 'default', 3)
ON CONFLICT (icon_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  asset_path = EXCLUDED.asset_path,
  acquisition_type = EXCLUDED.acquisition_type,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

UPDATE icon_master
SET is_active = false
WHERE icon_key IN ('default_02', 'default_03');

-- 2. 既存ユーザー全員に default_04 / default_05 を付与
INSERT INTO user_icons (user_id, icon_key, source)
SELECT u.user_id, im.icon_key, 'default_grant'
FROM users u
CROSS JOIN icon_master im
WHERE im.icon_key IN ('default_04', 'default_05')
  AND im.is_active = true
ON CONFLICT (user_id, icon_key) DO NOTHING;

-- 3. 選択中が無効化した default_02/03 なら default_01 に戻す
UPDATE users
SET selected_icon_key = 'default_01'
WHERE selected_icon_key IN ('default_02', 'default_03');

-- 確認
SELECT icon_key, asset_path, is_active, sort_order
FROM icon_master
WHERE icon_key LIKE 'default_%'
ORDER BY sort_order;
