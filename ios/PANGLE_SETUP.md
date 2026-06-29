# Pangle iOS SDK セットアップ（Capacitor）

## 導入方法

Pangle iOS SDK は **Swift Package Manager（SPM）** で導入しています。

- パッケージ URL: `https://github.com/bytedance/AdsGlobalPackage`
- バージョン: `8.1.0-release.9`（SPM タグ形式。`8.1.0` 単体では解決できません）
- CocoaPods は **不要**（Capacitor 8 の iOS テンプレートが SPM ベースのため）

## 必須設定

### 1. App ID（Info.plist）— ネイティブ SDK 用

**場所:** `ios/App/App/Info.plist` の `PangleAppId`

**手順:**

1. [Pangle 管理画面](https://www.pangleglobal.com/) にログイン
2. **アプリ管理** → 対象 iOS アプリを選択
3. **App ID**（数字の文字列）をコピー
4. Xcode で `ios/App/App.xcodeproj` を開く
5. 左ペイン **App** → **Info** タブ → **Custom iOS Target Properties**
6. `PangleAppId` の Value に貼り付け（空文字のままだと SDK 初期化がスキップされます）

または plist を直接編集:

```xml
<key>PangleAppId</key>
<string>YOUR_IOS_APP_ID</string>
```

起動時に `PangleSdkBootstrap` がこの値で SDK を初期化します。

### 2. App ID / Placement ID（.env）— Web 層用

**場所:** プロジェクトルートの `.env`（`.env.example` をコピーして作成）

バナー実表示テスト（`banner_home` のみ）に必要なのは次の **2 行** です:

```bash
VITE_PANGLE_IOS_APP_ID=YOUR_IOS_APP_ID          # Pangle管理画面の iOS App ID（Info.plist と同じ値）
VITE_PANGLE_IOS_BANNER_HOME=YOUR_PLACEMENT_ID    # Pangle管理画面「ホーム画面バナー」の Placement ID
```

**Placement ID の見つけ方:**

1. Pangle 管理画面 → **広告枠**（またはコード位 / Placement）
2. 広告枠名 **「ホーム画面バナー」**（320×50）を選択
3. **コード / Placement ID** をコピー → `VITE_PANGLE_IOS_BANNER_HOME` に貼り付け

> 他のバナー枠（account / roulette 等）は未設定のままで OK。グレー仮枠が表示されます。

| 設定場所 | キー | 用途 |
|---|---|---|
| `Info.plist` | `PangleAppId` | ネイティブ SDK 起動時初期化 |
| `.env` | `VITE_PANGLE_IOS_APP_ID` | Web → `initialize()` / `mountPangleBanner` |
| `.env` | `VITE_PANGLE_IOS_BANNER_HOME` | `banner_home` の Placement ID |

### 3. Linker Flag

`OTHER_LDFLAGS` に `-ObjC` を設定済みです（Pangle 公式要件）。

### 4. App Tracking Transparency（実機広告前）

`NSUserTrackingUsageDescription` を Info.plist に追加済みです。

### 5. SKAdNetwork（App Store 審査・収益化）

Pangle 公式の SKAdNetwork ID 一覧を `Info.plist` に追記する必要があります。  
現時点では未追加です（テスト段階では省略可）。

---

## バナー実表示テスト手順（iOS シミュレーター）

### コマンド

```bash
# 1. .env に VITE_PANGLE_IOS_APP_ID と VITE_PANGLE_IOS_BANNER_HOME を設定

# 2. Web をビルドして iOS に同期（env はビルド時に埋め込まれる）
npm run cap:sync ios

# 3. Xcode でシミュレーター実行（または CLI）
npm run cap:open:ios
# Product > Run（⌘R）で iPhone シミュレーターを選択
```

### 確認ポイント

1. アプリ起動 → **ホーム画面**（フッター直上の 320×50 枠）
2. 設定済みなら Pangle テスト広告または実広告が表示
3. 未設定なら従来どおりグレー仮枠「320×50 banner」

### Safari Web Inspector（JS ログ）

1. Mac の **Safari** → **設定** → **詳細** →「メニューバーに"開発"メニューを表示」
2. シミュレーターでアプリ起動
3. Safari **開発** → **Simulator** → **ワクポク**（または localhost）
4. **Console** タブで以下を確認:

```
[ad:config] platform ios
[ad:config] appId configured (****xxxx) env=VITE_PANGLE_IOS_APP_ID
[ad:config] placement banner_home configured (****xxxx) env=VITE_PANGLE_IOS_BANNER_HOME
[ad:banner] bridge available
[ad:banner] isAvailable true
[ad:banner] banner_home load start
[ad:bridge] loadBanner start { placementKey: 'banner_home', rect: { x, y, width, height } }
[ad:bridge] loadBanner complete { placementKey: 'banner_home' }
[ad:banner] banner_home load complete
```

**手動テスト（Console）:**

```javascript
window.StudyPointPangleAds.isAvailable()  // true

await window.StudyPointPangleAds.loadBanner({
  placementKey: 'banner_home',
  placementId: 'YOUR_PLACEMENT_ID',
  width: 320,
  height: 50,
  container: document.querySelector('.app-banner-under-footer'),
})
```

### Xcode コンソール（ネイティブログ）

Xcode 下部 **Debug area** で `[Pangle]` をフィルタ:

```
[Pangle] SDK initialized (version: ...)
[Pangle] banner load start placementKey=banner_home slot=... frame=(x,y) size=320x50
[Pangle] banner loaded placementKey=banner_home viewFrame={{...}}
```

失敗時:

```
[Pangle] PangleAppId is empty — SDK init skipped
[Pangle] initialize rejected: missing_app_id
[Pangle] banner load failed placementKey=banner_home error=...
[Pangle] loadBanner resolve failed placementKey=banner_home error=...
```

---

## バナーが出ない場合の原因候補

| 症状 / ログ | 原因 | 対処 |
|---|---|---|
| `[ad:config] appId not configured` | `.env` に `VITE_PANGLE_IOS_APP_ID` 未設定 | `.env` 設定後 `npm run cap:sync ios` |
| `[ad:banner] not configured, showing placeholder` | `VITE_PANGLE_IOS_BANNER_HOME` 未設定 | 同上 |
| `[Pangle] PangleAppId is empty` | Info.plist の `PangleAppId` が空 | Xcode で App ID を設定して再ビルド |
| `isAvailable` が `false` | ブラウザ（npm run dev）で確認している | **シミュレーター / 実機**の Capacitor アプリで確認 |
| `bridge unavailable` | `cap sync` 未実行 or プラグイン未登録 | `npm run cap:sync ios` → Xcode 再 Run |
| `missing_app_id` | Info.plist も JS の appId も空 | 両方に同じ App ID を設定 |
| `banner load failed` + Pangle エラー | Placement ID 誤り / 広告枠未有効化 | Pangle 管理画面で枠状態・ID を再確認 |
| `rect: { x:0, y:0, width:0, height:0 }` | 旧バージョンの座標バグ | 最新コードで `cap:sync` 済みか確認 |
| ログは成功だが見えない | 座標ズレ（WebView と UIView の差） | Xcode で `viewFrame` を確認。スクロール画面では未対応 |
| シミュレーターで fill 率 0% | テスト広告が配信されない環境 | **実機**でも試す。Pangle テストモード設定を確認 |
| env 変更が反映されない | Vite はビルド時に env を埋め込む | `.env` 変更後は必ず `npm run cap:sync ios` |

---

## JS ブリッジ（バナー）

`main.js` 起動時に `pangleNativeBridge.js` が `window.StudyPointPangleAds` を注入します。

通常は `pangleBanner.js` の `mountPangleBanner()` / `preloadHomeBannerAd()` から自動呼び出しされます。

## 次フェーズ（未実装）

- リワード / インステ広告
- ポイント付与・報酬処理との接続
- スクロール時のバナー位置追従
- SKAdNetwork ID を `Info.plist` に追加
