-- icon_system_p3_grant_logs.sql
-- ポイ丸アイコン P3: 付与ログテーブル（grantIconToUser 用）
--
-- 実行前提:
--   - icon_system_p0_schema.sql 実行済み
-- 触らないもの:
--   - points / pig_tickets / missions / gift_codes / roulette 関連

-- ============================================================
-- icon_grant_logs
-- ============================================================

CREATE TABLE IF NOT EXISTS icon_grant_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  icon_key text NOT NULL REFERENCES icon_master(icon_key),
  source text NOT NULL,
  source_ref text,
  grant_result text NOT NULL CHECK (grant_result IN ('granted', 'already_owned')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS icon_grant_logs_user_id_idx ON icon_grant_logs (user_id);

CREATE INDEX IF NOT EXISTS icon_grant_logs_created_at_idx ON icon_grant_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS icon_grant_logs_user_icon_idx ON icon_grant_logs (user_id, icon_key, created_at DESC);
