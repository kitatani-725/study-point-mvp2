-- points.user_id を 1 ユーザー 1 行にするための手順（Supabase SQL Editor で実行）
--
-- 0) 重複確認（任意）
-- SELECT user_id, COUNT(*) FROM points GROUP BY user_id HAVING COUNT(*) > 1;
--
-- 1) 既存の重複がある場合: 各 user_id について id が最小の行だけ残す
--    （本番で実行する前にバックアップまたは件数確認すること）
DELETE FROM points
WHERE id NOT IN (
  SELECT MIN(id)
  FROM points
  GROUP BY user_id
);

-- 2) user_id に UNIQUE 制約
--    既に同名制約がある場合はスキップするか、エラーを確認してから進める
ALTER TABLE points
  ADD CONSTRAINT points_user_id_key UNIQUE (user_id);

-- 代替: 制約名を付けず一意インデックスだけ付ける場合
-- CREATE UNIQUE INDEX IF NOT EXISTS points_user_id_key ON points (user_id);
