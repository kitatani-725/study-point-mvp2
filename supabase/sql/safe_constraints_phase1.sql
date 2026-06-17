-- safe_constraints_phase1.sql
-- 目的:
--   最小で安全な DB 保護を追加する（UNIQUE + CHECK）
-- 対象:
--   1) points.user_id UNIQUE
--   2) pig_tickets.user_id UNIQUE
--   3) mission_progresses(user_id, mission_key, period_key) UNIQUE
--   4) CHECK
--      - points.point >= 0
--      - pig_tickets.ticket_count >= 0
--      - mission_progresses.progress_value >= 0
--
-- 重要:
--   - まず「STEP 0: 事前検出」だけ実行し、結果を確認してから STEP 1 以降を実行すること。
--   - 本ファイルは即時本番適用を前提にしない。

-- ============================================================
-- STEP 0: 事前検出（先に必ず実行）
-- ============================================================

-- 0-1. points.user_id 重複検出
SELECT user_id, COUNT(*) AS row_count
FROM points
GROUP BY user_id
HAVING COUNT(*) > 1;

-- 0-2. pig_tickets.user_id 重複検出
SELECT user_id, COUNT(*) AS row_count
FROM pig_tickets
GROUP BY user_id
HAVING COUNT(*) > 1;

-- 0-3. mission_progresses(user_id, mission_key, period_key) 重複検出
SELECT user_id, mission_key, period_key, COUNT(*) AS row_count
FROM mission_progresses
GROUP BY user_id, mission_key, period_key
HAVING COUNT(*) > 1;

-- 0-4. CHECK 制約違反候補の検出
SELECT id, user_id, point
FROM points
WHERE point < 0;

SELECT user_id, ticket_count
FROM pig_tickets
WHERE ticket_count < 0;

SELECT id, user_id, mission_key, period_key, progress_value
FROM mission_progresses
WHERE progress_value < 0;

-- 判定:
--   上記の 6 クエリがすべて 0 件なら STEP 1 へ進んでよい。
--   1 件でも返る場合は、先にデータ修正してから適用すること。

-- ============================================================
-- STEP 1: UNIQUE 制約の追加（重複ゼロ確認後）
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'points_user_id_key'
      AND conrelid = 'points'::regclass
  ) THEN
    ALTER TABLE points
      ADD CONSTRAINT points_user_id_key UNIQUE (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pig_tickets_user_id_key'
      AND conrelid = 'pig_tickets'::regclass
  ) THEN
    ALTER TABLE pig_tickets
      ADD CONSTRAINT pig_tickets_user_id_key UNIQUE (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mission_progresses_user_mission_period_key'
      AND conrelid = 'mission_progresses'::regclass
  ) THEN
    ALTER TABLE mission_progresses
      ADD CONSTRAINT mission_progresses_user_mission_period_key
      UNIQUE (user_id, mission_key, period_key);
  END IF;
END $$;

-- ============================================================
-- STEP 2: CHECK 制約の追加（負数データゼロ確認後）
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'points_point_non_negative_chk'
      AND conrelid = 'points'::regclass
  ) THEN
    ALTER TABLE points
      ADD CONSTRAINT points_point_non_negative_chk
      CHECK (point >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pig_tickets_ticket_count_non_negative_chk'
      AND conrelid = 'pig_tickets'::regclass
  ) THEN
    ALTER TABLE pig_tickets
      ADD CONSTRAINT pig_tickets_ticket_count_non_negative_chk
      CHECK (ticket_count >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mission_progresses_progress_value_non_negative_chk'
      AND conrelid = 'mission_progresses'::regclass
  ) THEN
    ALTER TABLE mission_progresses
      ADD CONSTRAINT mission_progresses_progress_value_non_negative_chk
      CHECK (progress_value >= 0);
  END IF;
END $$;

-- ============================================================
-- STEP 3: 適用後確認
-- ============================================================

SELECT conname, conrelid::regclass AS table_name, contype
FROM pg_constraint
WHERE conname IN (
  'points_user_id_key',
  'pig_tickets_user_id_key',
  'mission_progresses_user_mission_period_key',
  'points_point_non_negative_chk',
  'pig_tickets_ticket_count_non_negative_chk',
  'mission_progresses_progress_value_non_negative_chk'
)
ORDER BY conrelid::regclass::text, conname;
