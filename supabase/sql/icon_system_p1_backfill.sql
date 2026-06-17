-- icon_system_p1_backfill.sql
-- ポイ丸アイコン機能 P1: 既存ユーザーへの初期付与・selected_icon_key 初期化
--
-- 実行前提:
--   - icon_system_p0_schema.sql を先に実行済みであること
-- 触らないもの:
--   - points / pig_tickets / missions / gift_codes / roulette 関連

-- ============================================================
-- 1. 既存ユーザー全員に初期アイコン 3 個を付与
-- ============================================================

INSERT INTO user_icons (user_id, icon_key, source)
SELECT u.user_id, im.icon_key, 'default_grant'
FROM users u
CROSS JOIN icon_master im
WHERE im.acquisition_type = 'default'
  AND im.is_active = true
ON CONFLICT (user_id, icon_key) DO NOTHING;

-- ============================================================
-- 2. selected_icon_key が NULL のユーザーに default_01 をセット
-- ============================================================

UPDATE users
SET selected_icon_key = 'default_01'
WHERE selected_icon_key IS NULL;
