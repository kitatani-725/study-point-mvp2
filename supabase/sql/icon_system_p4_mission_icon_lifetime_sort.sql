-- icon_system_p4_mission_icon_lifetime_sort.sql
-- 累計ミッションの sort_order を target_value 基準に揃える（任意・JS側でも並び替え済み）
--
-- 実行前提:
--   - icon_system_p4_mission_icon_lifetime.sql 実行済み

UPDATE missions
SET sort_order = 101
WHERE mission_key = 'lifetime_login_101';

UPDATE missions
SET sort_order = 366
WHERE mission_key = 'lifetime_login_366';

UPDATE missions
SET sort_order = 31
WHERE mission_key = 'lifetime_login_31';

-- 確認（累計ログイン系）
SELECT mission_key, title, target_value, reward_type, sort_order
FROM missions
WHERE category = 'lifetime' AND mission_key LIKE 'lifetime_login_%'
ORDER BY target_value;
