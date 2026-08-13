# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業するときに必ず守る現行構成・開発方針です。
古いドキュメントや過去コミットの構成より、まずこのファイルと現在の `src/` を優先してください。

## このリポジトリについて

小田原鉱石株式会社向けのアスベスト調査システムPWA本開発版です。
ビルドツールやbundlerは使わず、HTML / CSS / JavaScript（ES Modules）をFirebase Hostingで静的配信します。
Firebase Authentication、Firestore、Microsoft Graph / SharePoint等との連携を段階的に実装します。

## 最重要: `src/` が唯一の本開発正本

**アプリ本体の新規開発・修正は、すべて `src/` 配下だけで行います。**

- `src/app.html` が本開発アプリ本体です。
- `src/index.html` はFirebase Hostingのドメイン直下 `/` から `./app.html` へ遷移する最小入口です。
- `src/config/`、`src/css/`、`src/js/`、`src/version.json` が本開発で使用する実ファイルです。
- リポジトリ直下に `app.html`、`index.html`、`camera.html`、`survey-map.html`、`assets/`、`config/`、`css/`、`js/`、`version.json` などのアプリ本体コピーを作らないでください。
- `src/` の内容をリポジトリ直下へコピー・同期する運用は禁止です。二重の正本を作らないでください。

旧v0.15.10は本開発リポジトリ内では管理しません。別途保管済みです。
旧版比較のために直下 `app.html` や `archive/v0.15.10/` を復活させないでください。
過去挙動の確認が必要な場合は、ユーザーから明示的に提供された旧版ファイルを参照してください。

## Firebase Hosting

`firebase.json` の公開対象は次です。

```json
{
  "hosting": {
    "public": "src"
  }
}
```

したがってFirebase HostingのURL構造は、`src/` をサイトルートとして扱います。

- `/` -> `src/index.html` -> `./app.html` へ遷移
- `/app.html` -> `src/app.html`
- `/css/...` -> `src/css/...`
- `/js/...` -> `src/js/...`
- `/config/...` -> `src/config/...`
- `/version.json` -> `src/version.json`

Firebase Hostingの公開先を `.` に戻さないでください。
デプロイ前に `src/` を直下へ展開する処理も追加しないでください。

GitHubの `main` へのpushで `.github/workflows/firebase-hosting-deploy.yml` がFirebase Hostingのlive channelへ自動デプロイします。
このworkflowはFirebase Actionにリポジトリを渡すだけで、アプリファイルのコピー処理は行いません。

## ルート直下に残る補助ファイル

現時点で `404.html`、`manifest.json`、`service-worker.js` はルート直下に残っていますが、`public: "src"` のためFirebase Hostingの本開発配信対象ではありません。
これらは本開発で正式利用する段階で、仕様を確認したうえで `src/` 側へ正式実装・移行します。
今は勝手に `src/` へコピーしたり、旧内容を本開発から参照したりしないでください。

`archive/README.md` はアーカイブ運用方針のメモとして残っています。`archive/v0.15.10/` は存在しません。

## 現在の開発バージョンと位置づけ

現在の本開発確定版は **v0.1.5.2** です。
レビュー版は同一機能段階内で `v0.1.5.3A`、`v0.1.5.3B` ... のように英字枝番で管理し、確認OK後に `v0.1.5.3` のような正式版へ確定します。

直近では次の領域まで本開発構造へ移行済みです。

- 仕上表UI / finishRecord
- materialRecord / 建材リスト
- 建材採取設定UI
- 建材統合・削除
- レコード確認UI（仕上表・建材。写真レコードは次段階）

次段階は写真機能で、まずphotoRecord基盤から実装します。

## `src/` の構成原則

`src/app.html` は画面の土台に留め、機能ロジックを巨大なinline scriptへ戻さないでください。

### 主な構成

- `src/js/app-init.js`
  - アプリ起動の唯一の入口
  - 各UI/機能の初期化を呼び出す
- `src/js/ui/`
  - タブ、ドロワー、モーダル、認証UIなど共通画面部品
- `src/js/finish-table/`
  - 仕上表のstate / view-model / renderer / controller / actions / history
- `src/js/materials/`
  - 簡易リスト、建材リスト、統合・削除UI/業務処理
- `src/js/records/`
  - Recordの構造・生成・正規化
- `src/js/store/`
  - Record Store
- `src/js/record-view/`
  - レコード確認画面
- `src/js/demo/`
  - 現段階の確認用サンプル案件・サンプルデータ
- `src/config/`
  - Firebase / Microsoft / アプリ設定
- `src/css/`
  - 機能単位のスタイル

## コード変更の原則

### 1. 継ぎ足しパッチではなく、責務単位で整理して書き換える

既存関数の末尾へ例外処理を積み重ねたり、同じ責務の別関数を増やして回避したりしないでください。
修正対象の責務を確認し、必要ならそのモジュール・関数を整理した上で適切に書き換えます。

### 2. 一つの正本を守る

同じ情報を複数Storeや複数ファイルで別々の正本として持たないでください。
派生できる値は正本Recordから派生させます。

現在の主Recordは次の3つです。

- 仕上表レコード（finishRecord）
- 建材レコード（materialRecord）
- 写真レコード（photoRecord）

独立した部屋Recordは作りません。

### 3. Store / ViewModel / Renderer / Controllerの責務を分ける

- Store: Recordの保持・更新・購読
- ViewModel: Recordから表示用データを作る
- Renderer: DOMを描画する
- Controller: ユーザー操作とStore更新をつなぐ

表示都合の処理をRecordへ混ぜたり、Rendererから直接Storeを書き換えたりしないでください。

### 4. 既存の確定済み機能を不用意に触らない

新しい機能を追加するときは、既にレビュー済みの仕上表・建材リスト・統合削除等を必要なく書き換えないでください。
必要な変更範囲を先に明確化します。

### 5. iPad / Apple Pencil操作を維持する

仕上表・建材リストでは、Pencilの単純タップとスクロールドラッグを区別し、ドラッグ中に不用意な編集開始をしない設計を維持します。
編集セルの再描画でカーソル位置や選択状態を壊さないでください。

## Record方針

### finishRecord

- `1入力枠 = 1仕上表レコード`
- 空の入力枠もRecordとして存在する
- finishIdは位置を表すIDで、部屋追加・挿入等により変わり得る
- 建材との紐付けはmaterialIdを使用する

### materialRecord

- materialIdは固定
- 建材No.は現在の一覧位置
- 部位・使用箇所はfinishRecordから派生
- 通常UIに表示するのは `status = active` の建材
- `merged` / `deleted` は履歴としてRecordには残すが通常UIから除外

### photoRecord

写真機能は次段階で正式実装します。
目視写真は部屋位置＋部位を基準にし、materialIdを正本として持たせない方針です。
採取写真はmaterialId、採取場所、採取枝番、試料No.、部位、撮影区分を基準にします。
撮影区分のUI表示は `施工前 / 施工中 / 施工後 / 断面` とします。

## 認証・外部連携

- Firebase AuthのMicrosoftログインを使用
- Microsoft Graph access tokenは `sessionStorage` のみ
- client secret、service account key、access token等の秘密情報をコミットしない
- Firebase Web API keyはクライアント設定として扱う

OneDrive / Firestore / 端末間同期等は、実装段階ごとの正式仕様に従って追加します。
古い旧版コードの保存・同期方式をそのまま持ち込まないでください。

## 開発・確認

このリポジトリにはpackage.jsonやbuild stepはありません。
HTML/CSS/JSを直接編集します。

ローカル確認時は静的HTTPサーバーのルートを `src/` にするのが最も本番に近い構成です。
例:

```bash
cd src
python -m http.server 8000
```

その場合、`http://localhost:8000/` から `index.html` 経由で `app.html` が開きます。

## ドキュメントについて

`docs/` には過去時点の計画・仕様メモも含まれます。
特に `docs/project-structure.md` は現在の実構成と一致しない箇所が残っている可能性があります。
古いドキュメントだけを根拠に、現在の `src/` 構成やFirebase設定を戻さないでください。
構成判断は **このCLAUDE.md、現在のfirebase.json、現在のsrc/** を優先します。

## 言語

ユーザー向け文言、コードコメント、開発メモは原則として日本語を使用します。
