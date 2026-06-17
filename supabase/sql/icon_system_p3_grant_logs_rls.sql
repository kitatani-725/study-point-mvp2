-- icon_system_p3_grant_logs_rls.sql
-- icon_grant_logs 向け RLS（匿名 user_id 方式）
--
-- 実行前提:
--   - icon_system_p3_grant_logs.sql 実行済み
-- 触らないもの:
--   - points / pig_tickets / missions / gift_codes / roulette 関連

GRANT SELECT, INSERT ON TABLE public.icon_grant_logs TO anon, authenticated;

ALTER TABLE public.icon_grant_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS icon_grant_logs_select_anon ON public.icon_grant_logs;
CREATE POLICY icon_grant_logs_select_anon
  ON public.icon_grant_logs
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS icon_grant_logs_insert_anon ON public.icon_grant_logs;
CREATE POLICY icon_grant_logs_insert_anon
  ON public.icon_grant_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
