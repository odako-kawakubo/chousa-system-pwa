# 現在のフォルダ構成メモ

更新日：2026-08-06

## このメモの位置づけ

このZIPに入っている `src/` 中心の構成は、2026-08-05時点で作成した初期案です。

その後の検討により、本開発版ではGitHub Pagesから直接公開しやすく、画面・機能ごとの責任範囲が分かりやすい構成へ整理する方針になりました。

現時点では、既存ファイルを一気に移動・削除せず、まずこのメモを基準に次の構成へ段階的に移行します。

---

## 現在採用する予定の全体構成

```text
chousa-system-pwa/
│
├─ index.html
├─ app.html
├─ camera.html
├─ survey-map.html
│
├─ manifest.json
├─ service-worker.js
├─ README.md
│
├─ config/
│  ├─ firebase-config.js
│  ├─ microsoft-config.js
│  └─ app-config.js
│
├─ css/
│  ├─ common.css
│  ├─ login.css
│  ├─ app.css
│  ├─ camera.css
│  └─ survey-map.css
│
├─ js/
│  ├─ main.js
│  │
│  ├─ auth/
│  │  └─ microsoft-auth.js
│  │
│  ├─ firebase/
│  │  ├─ firestore.js
│  │  └─ storage.js
│  │
│  ├─ records/
│  │  ├─ material-record.js
│  │  ├─ finish-record.js
│  │  └─ photo-record.js
│  │
│  ├─ finish-table/
│  │  ├─ finish-table.js
│  │  └─ finish-table-ui.js
│  │
│  ├─ material-list/
│  │  ├─ material-list.js
│  │  └─ material-list-ui.js
│  │
│  ├─ photo/
│  │  ├─ photo.js
│  │  ├─ visual-survey.js
│  │  ├─ sampling.js
│  │  └─ photo-ui.js
│  │
│  ├─ survey-map/
│  │  ├─ survey-map.js
│  │  └─ survey-map-ui.js
│  │
│  ├─ sync/
│  │  ├─ sync-manager.js
│  │  └─ sync-status.js
│  │
│  ├─ sharepoint/
│  │  ├─ graph-client.js
│  │  ├─ sharepoint-files.js
│  │  └─ excel-reader.js
│  │
│  ├─ project/
│  │  ├─ project-manager.js
│  │  └─ project-panel.js
│  │
│  ├─ operations/
│  │  ├─ merge.js
│  │  ├─ delete.js
│  │  ├─ status.js
│  │  └─ maintenance.js
│  │
│  ├─ settings/
│  │  └─ settings.js
│  │
│  └─ utils/
│     ├─ constants.js
│     ├─ normalize.js
│     ├─ id-generator.js
│     └─ error-handler.js
│
├─ assets/
│  ├─ icons/
│  └─ images/
│
├─ docs/
│  └─ 現在のフォルダ構成メモ.md
│
└─ archive/
   └─ README.md
```

---

## 各HTMLの役割

### `index.html`

Microsoftアカウントによるログイン画面です。

### `app.html`

仕上表、建材リスト、写真管理、案件操作などを扱うメイン画面です。

### `camera.html`

写真撮影に特化した画面です。

### `survey-map.html`

調査図に特化した画面です。調査図機能は本体から分離して管理します。

---

## 設定ファイル

### `config/firebase-config.js`

Firebase Web SDKの公開設定とFirebase初期化を管理します。

主な項目：

```text
apiKey
authDomain
projectId
storageBucket
messagingSenderId
appId
```

### `config/microsoft-config.js`

Microsoft EntraおよびMicrosoft Graphで使用する公開設定を管理します。

主な項目：

```text
clientId
tenantId
scope
SharePointサイト情報
```

### `config/app-config.js`

アプリ名、バージョン、同期設定、写真設定、各種初期値などを管理します。

### GitHubへ置かないもの

次の情報は、HTML・JavaScript・設定ファイル・GitHubへ保存しません。

```text
Microsoftのクライアントシークレット
Microsoft Graphのアクセストークン
更新トークン
管理者パスワード
サービスアカウント秘密鍵
```

---

## JavaScriptの役割分担

### `js/auth/`

Microsoftログイン、ログアウト、Firebase Authenticationのログイン状態監視を担当します。

### `js/firebase/`

FirestoreとFirebase Storageへの接続処理を集約します。

各画面や各機能からFirebaseを直接操作せず、この層を通す方針です。

### `js/records/`

システムの基礎データを管理します。

現時点の主要レコードは次の3種類です。

```text
建材レコード
仕上表レコード
写真レコード
```

部屋専用の独立レコードは設けず、必要な部屋情報は各レコード内で管理します。

### `js/finish-table/`

仕上表の業務処理と画面処理を管理します。

### `js/material-list/`

建材リストの業務処理と画面処理を管理します。

### `js/photo/`

写真管理を担当します。

目視調査と採取写真は同じ写真基盤を使いつつ、処理ファイルを分けます。

### `js/sync/`

端末内データとFirestoreの差分同期、同期状態表示を担当します。

### `js/sharepoint/`

Microsoft Graphを使用し、SharePointの案件フォルダ、Excel、PDF、画像などへアクセスします。

### `js/project/`

案件の選択、作成、切り替え、案件パネル表示を担当します。

### `js/operations/`

建材の統合、削除、状態変更、保守処理など、通常入力とは分けたい操作を担当します。

### `js/utils/`

共通定数、文字列正規化、ID生成、エラー処理などを管理します。

---

## 現時点の同期方針

- Firestoreを複数端末間の同期先として使用する
- 端末内データを優先して編集できるローカルファースト構成にする
- 初回表示時に、建材・仕上表・写真の各レコードを取得する
- 初回取得後はlistenerで変更されたレコードだけを反映する
- 毎回全件を保存・再描画せず、変更対象だけを更新する
- 一般データの送信失敗後は自動連続再試行を行わない
- 次回編集時または手動同期時に再送する
- 写真は初回アップロードを自動実行する
- 写真アップロード失敗後は自動連続再試行を行わず、手動同期等で再送する

---

## 既存ZIPからの移行方針

現在ZIP内にある次の構成は初期案として残っています。

```text
src/
styles/
index.html
manifest.json
service-worker.js
```

移行時の基本対応は次の予定です。

```text
styles/app.css
→ css/app.css

src/10_config.js
→ config/ と js/utils/ へ役割を分割

src/40_sync.js
→ js/sync/ と js/firebase/ へ分割

src/50_material_record.js
→ js/records/material-record.js

src/60_shijo.js
→ js/finish-table/ と js/records/finish-record.js

src/70_material_list.js
→ js/material-list/

src/80_photos.js
→ js/photo/ と js/records/photo-record.js

src/90_ui.js
→ 各機能の `*-ui.js` へ分割
```

`src/`を残したまま新構成を継ぎ足すのではなく、移行単位を決めて段階的に置き換えます。

---

## 最初に作成する最小構成

最初から全ファイルへ実装を入れず、まず次の範囲を作成します。

```text
index.html
app.html
manifest.json
service-worker.js

config/
├─ firebase-config.js
├─ microsoft-config.js
└─ app-config.js

css/
├─ common.css
├─ login.css
└─ app.css

js/
├─ main.js
└─ auth/
   └─ microsoft-auth.js

assets/
└─ icons/

archive/
└─ README.md
```

最初の確認範囲は次のとおりです。

```text
index.htmlを開く
↓
Microsoftアカウントでログイン
↓
Firebase Authenticationのログイン成功を確認
↓
app.htmlへ移動
↓
ログインユーザー名を表示
```

その後、Microsoft Graphのアクセストークン取得とSharePoint接続を確認します。
