-- safe_constraints_phase1_rollback.sql
-- 目的:
--   safe_constraints_phase1.sql で追加した制約を戻す。
-- 注意:
--   制約を外すと不正データ（重複・負数）が再び入る余地が生まれる。

ALTER TABLE mission_progresses
  DROP CONSTRAINT IF EXISTS mission_progresses_progress_value_non_negative_chk;

ALTER TABLE pig_tickets
  DROP CONSTRAINT IF EXISTS pig_tickets_ticket_count_non_negative_chk;

ALTER TABLE points
  DROP CONSTRAINT IF EXISTS points_point_non_negative_chk;

ALTER TABLE mission_progresses
  DROP CONSTRAINT IF EXISTS mission_progresses_user_mission_period_key;

ALTER TABLE pig_tickets
  DROP CONSTRAINT IF EXISTS pig_tickets_user_id_key;

ALTER TABLE points
  DROP CONSTRAINT IF EXISTS points_user_id_key;
