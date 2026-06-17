-- icon_system_p5_roulette_icons.sql
-- ルーレット限定アイコン（roulette_01〜05）を icon_master に登録
--
-- 実行前提:
--   - icon_system_p0_schema.sql 実行済み
-- 触らないもの:
--   - points / pig_tickets / missions / gift_codes 関連

INSERT INTO icon_master (
  icon_key,
  display_name,
  asset_path,
  acquisition_type,
  sort_order,
  roulette_eligible,
  is_active
)
VALUES
  ('roulette_01', 'ルーレット ⭐️ 1', '/assets/icon/roulette_01.svg', 'roulette', 201, true, true),
  ('roulette_02', 'ルーレット ⭐️ 2', '/assets/icon/roulette_02.svg', 'roulette', 202, true, true),
  ('roulette_03', 'ルーレット ⭐️ 3', '/assets/icon/roulette_03.svg', 'roulette', 203, true, true),
  ('roulette_04', 'ルーレット ⭐️ 4', '/assets/icon/roulette_04.svg', 'roulette', 204, true, true),
  ('roulette_05', 'ルーレット ⭐️ 5', '/assets/icon/roulette_05.svg', 'roulette', 205, true, true)
ON CONFLICT (icon_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  asset_path = EXCLUDED.asset_path,
  acquisition_type = EXCLUDED.acquisition_type,
  sort_order = EXCLUDED.sort_order,
  roulette_eligible = true,
  is_active = true;

SELECT icon_key, asset_path, acquisition_type, roulette_eligible, is_active
FROM icon_master
WHERE icon_key LIKE 'roulette_%'
ORDER BY sort_order;
