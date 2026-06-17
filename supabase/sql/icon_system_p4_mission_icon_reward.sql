-- icon_system_p4_mission_icon_reward.sql
-- ミッション報酬に icon タイプを追加（reward_icon_key カラム）
--
-- 実行前提:
--   - icon_system_p0_schema.sql 実行済み
--   - missions テーブルが存在すること
-- 触らないもの:
--   - points / pig_tickets / gift_codes / roulette 関連

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS reward_icon_key text REFERENCES icon_master(icon_key);
