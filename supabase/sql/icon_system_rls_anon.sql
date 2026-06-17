-- icon_system_rls_anon.sql
-- ポイ丸アイコン: 匿名 user_id 方式（localStorage → users.user_id）向け RLS
--
-- 前提:
--   - icon_system_p0_schema.sql 実行済み
--   - Supabase Auth は使わず、クライアントは anon キーで接続
--   - auth.uid() は使わない（anon 向けに permissive ポリシー）
--
-- 触らないもの:
--   - points / pig_tickets / missions / gift_codes / roulette 関連テーブル
--
-- Supabase SQL Editor でこのファイル全文を実行してください。

-- ============================================================
-- 0. 既存ポリシーを掃除（再実行しても安全）
-- ============================================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'icon_master'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.icon_master', pol.policyname);
  END LOOP;

  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_icons'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_icons', pol.policyname);
  END LOOP;
END $$;

-- ============================================================
-- 1. テーブル権限（RLS と別に anon / authenticated へ GRANT が必要）
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON TABLE public.icon_master TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.user_icons TO anon, authenticated;

-- ============================================================
-- 2. RLS 有効化
-- ============================================================

ALTER TABLE public.icon_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_icons ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. icon_master: 参照のみ（有効マスタ）
-- ============================================================

CREATE POLICY icon_master_select_anon
  ON public.icon_master
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- ============================================================
-- 4. user_icons: select / insert / update
--    auth.uid() は使わない。anon キー + クライアント送信 user_id 前提。
--    ※ users テーブルに RLS がある場合、EXISTS (users) 条件は読めず拒否になるため
--       ここでは WITH CHECK (true) で許可（他テーブルと同様の匿名運用）
-- ============================================================

CREATE POLICY user_icons_select_anon
  ON public.user_icons
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY user_icons_insert_anon
  ON public.user_icons
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY user_icons_update_anon
  ON public.user_icons
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 5. users.selected_icon_key 更新用（アイコン選択時）
--    users テーブルに RLS がある場合のみ必要。無ければ影響なし。
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'users'
  ) THEN
    -- users に RLS が無効ならスキップ
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'users'
        AND c.relrowsecurity = true
    ) THEN
      EXECUTE 'DROP POLICY IF EXISTS users_update_selected_icon_anon ON public.users';
      EXECUTE $policy$
        CREATE POLICY users_update_selected_icon_anon
          ON public.users
          FOR UPDATE
          TO anon, authenticated
          USING (true)
          WITH CHECK (true)
      $policy$;
    END IF;
  END IF;
END $$;
