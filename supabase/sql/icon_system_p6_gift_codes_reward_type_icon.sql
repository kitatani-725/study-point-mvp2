-- icon_system_p6_gift_codes_reward_type_icon.sql
-- gift_codes / gift_code_redemptions の reward_type に icon を許可し、POIMARU2026 を登録
--
-- 実行前提:
--   - icon_system_p0_schema.sql 実行済み
-- 触らないもの:
--   - points / pig_tickets / missions / roulette 関連
--   - 既存 gift_codes / gift_code_redemptions の points / pig_tickets 行

-- 1. reward_icon_key（未追加環境向け）
ALTER TABLE gift_codes
  ADD COLUMN IF NOT EXISTS reward_icon_key text REFERENCES icon_master(icon_key);

-- 2. gift_codes.reward_type CHECK を差し替え
ALTER TABLE gift_codes
  DROP CONSTRAINT IF EXISTS gift_codes_reward_type_check;

ALTER TABLE gift_codes
  ADD CONSTRAINT gift_codes_reward_type_check
  CHECK (reward_type IN ('points', 'point', 'pig_tickets', 'pig_ticket', 'icon'));

-- 3. gift_code_redemptions.reward_type CHECK を差し替え（アプリ適用時に必要）
ALTER TABLE gift_code_redemptions
  DROP CONSTRAINT IF EXISTS gift_code_redemptions_reward_type_check;

ALTER TABLE gift_code_redemptions
  ADD CONSTRAINT gift_code_redemptions_reward_type_check
  CHECK (reward_type IN ('points', 'point', 'pig_tickets', 'pig_ticket', 'icon'));

-- 4. テスト用限定アイコン（未登録環境向け）
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

-- 5. POIMARU2026 を upsert（code UNIQUE が無い環境でも動作）
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
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'gift_codes'::regclass
  AND conname = 'gift_codes_reward_type_check';

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'gift_code_redemptions'::regclass
  AND conname = 'gift_code_redemptions_reward_type_check';

SELECT code, reward_type, reward_icon_key, reward_amount, max_uses, used_count, is_active
FROM gift_codes
WHERE code = 'POIMARU2026';
