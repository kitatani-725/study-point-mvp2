-- icon_system_fix_asset_paths.sql
-- icon_master の asset_path を public/assets/icon/ に合わせて更新
-- 初期デフォルト: default_01 / default_04 / default_05

UPDATE icon_master
SET asset_path = '/assets/icon/default_01.svg',
    is_active = true
WHERE icon_key = 'default_01';

UPDATE icon_master
SET asset_path = '/assets/icon/default_04.svg',
    is_active = true,
    acquisition_type = 'default',
    sort_order = 2,
    display_name = 'ポイ丸 4'
WHERE icon_key = 'default_04';

UPDATE icon_master
SET asset_path = '/assets/icon/default_05.svg',
    is_active = true,
    acquisition_type = 'default',
    sort_order = 3,
    display_name = 'ポイ丸 5'
WHERE icon_key = 'default_05';

UPDATE icon_master
SET is_active = false
WHERE icon_key IN ('default_02', 'default_03');

-- 確認用（アクティブな default 3 件・パスがすべて異なること）
SELECT icon_key, asset_path, is_active
FROM icon_master
WHERE icon_key IN ('default_01', 'default_04', 'default_05')
ORDER BY sort_order;
