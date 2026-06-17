-- icon_system_p4_mission_icon_reward_test.sql
-- テスト用: 1 ミッションをアイコン報酬に変更
--
-- 実行前提:
--   - icon_system_p4_mission_icon_reward.sql 実行済み
--   - default_04 が icon_master に存在すること
--
-- 対象: lifetime_login_1（初回ログイン系・lifetime）
-- 本番で別ミッションにする場合は WHERE を変更してください。

UPDATE missions
SET
  reward_type = 'icon',
  reward_amount = 0,
  reward_icon_key = 'default_04'
WHERE mission_key = 'lifetime_login_1'
  AND category = 'lifetime';

-- 確認
SELECT mission_key, category, title, reward_type, reward_amount, reward_icon_key
FROM missions
WHERE mission_key = 'lifetime_login_1';
