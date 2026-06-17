-- icon_system_p6_gift_code_icon.sql
-- ギフトコードでアイコン付与（reward_icon_key + テストデータ）
--
-- 実行前提:
--   - icon_system_p0_schema.sql 実行済み
--   - gift_codes テーブルが存在すること
-- 触らないもの:
--   - points / pig_tickets / missions / roulette 関連

-- 1. gift_codes に reward_icon_key を追加
ALTER TABLE gift_codes
  ADD COLUMN IF NOT EXISTS reward_icon_key text REFERENCES icon_master(icon_key);

-- 2. テスト用限定アイコン（icon_master）
INSERT INTO icon_master (
  icon_key,
  display_name,
  asset_path,
  acquisition_type,
  sort_order,
  roulette_eligible,
  is_active
)
VALUES (
  'gift_01',
  '限定ポイ丸★★★',
  '/assets/icon/gift_01.svg',
  'gift_code',
  301,
  false,
  true
)
ON CONFLICT (icon_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  asset_path = EXCLUDED.asset_path,
  acquisition_type = EXCLUDED.acquisition_type,
  sort_order = EXCLUDED.sort_order,
  roulette_eligible = false,
  is_active = true;

-- 3. テスト用ギフトコード（CHECK 更新後に実行すること）
UPDATE gift_codes
SET
  reward_type = 'icon',
  reward_icon_key = 'gift_01',
  reward_amount = 1,
  max_uses = 9999,
  used_count = 0,
  is_active = true,
  updated_at = now()
WHERE code = 'POIMARU2026';

INSERT INTO gift_codes (
  code,
  reward_type,
  reward_icon_key,
  reward_amount,
  max_uses,
  used_count,
  is_active
)
SELECT
  'POIMARU2026',
  'icon',
  'gift_01',
  1,
  9999,
  0,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM gift_codes WHERE code = 'POIMARU2026'
);

-- 確認
SELECT icon_key, display_name, asset_path, acquisition_type, roulette_eligible, is_active
FROM icon_master
WHERE icon_key = 'gift_01';

SELECT code, reward_type, reward_icon_key, reward_amount, max_uses, is_active
FROM gift_codes
WHERE code = 'POIMARU2026';
