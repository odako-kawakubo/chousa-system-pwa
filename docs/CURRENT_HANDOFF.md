# しらべ — 現在の開発引き継ぎ

最終確認: 2026-11-18。**この文書は進捗メモ。GitHubのブランチ・コード・Actionsと必ず再照合する。**
実装・レビュー公開・main更新・本番公開の承認はそれぞれ独立。優先規定: [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)。

## 現在地

- 対象: **v0.1.9.11G**（複数棟の機能統合・保存同期）。
- ベース: `feature/photo-building-11F`、開発ブランチ: `work/v0.1.9.11G-multi-building`。
- 本番 `main` は v0.1.9.11.3。**11Gは本番未反映**。
- 指定レビュー先: `https://odako-chousa-system-pwa--review-photo-pdf-amypbo0x.web.app/app.html`。**11Gは未公開**。URLの存在は11G公開完了を意味しない。
- 承認済み範囲: 11Gの開発。棟削除機能は作らない。棟追加はUndo/Redo対象外。レビュー公開・main反映・本番公開はまだ個別の承認が必要。
- オフライン時に複数端末から同じ案件へ棟・階・部屋・建材を同時追加するID衝突は、原則として運用で回避。全面的なID体系変更を行わない。

## 11Gブランチへ反映した内容（コード実装、実機未確認）

1. `src/js/projects/project-building-service.js` — 通常案件でもローカル採番→案件情報・仕上表へ反映→未送信キューによるFirestore同期に変更。A棟の従来ID、B棟以降のIDを維持。棟削除や棟追加Undo/Redoは実装しない。
2. `src/js/finish-table/finish-table-controller.js` — ローカル追加成功と同期待ちを区別して案内。
3. `src/js/firestore/firestore-repository.js` / `src/js/sync/project-record-persistence.js` — 不要になったオンライン専用の棟予約処理を削除。
4. `src/css/layout.css` — 11.3の案件選択UI（最大幅520px、案件行最小56px、検索38px、リスト内スクロール）を11Gへ統合。
5. `src/config/app-config.js` / `src/version.json` / `src/service-worker.js` — 開発版番号を11Gに統一。

## 2026-11-18 帳票棟名称の開発反映（未テスト）

- `project-buildings.js`: 帳票用の棟名称取得（設定済み名称優先、未設定はA棟/B棟）を追加。棟IDは維持。
- `output-view-model.js`: 複数棟の建材リスト使用箇所、部屋別リスト階、目視写真候補、採取写真帳の場所に帳票用棟名称を受け渡す。単棟の従来出力は変更しない。
- `output-view-model.js`: `findVisual` の検索条件に `buildingId` を追加し、同じ部屋位置を持つ異なる棟の目視写真混同を防ぐ。
- `room-location.js` / `material-usage-derived.js`: 採取場所の部屋参照に `buildingId` を保持。
- `output-pdf-renderer.js` / `output-export-controller.js`: PDF/印刷/Excelに同じ棟名称を表示。帳票の列構成や内部参照IDは変更しない。
- 静的差分検査は実施。**構文テスト、画面描画、PDF/Excelの実ファイル生成、実機検証は未実施**。

## 2026-11-18 保存・同期と使用箇所の追加修正（未テスト）

- `src/js/projects/project-record-apply.js`: 他端末からfinish/materialの差分を受信した後、建材部位・使用箇所の派生値をローカル再計算。全件復元時だけ再計算されていた差を解消。
- `src/js/finish-table/material-usage-derived.js`: B棟以降の使用箇所を `B-1-1` のように区別。帳票用には接頭辞のない `rawDisplay` を提供し、棟名称と二重表示しない。受信時の派生値再計算では`fieldEditedAt`を更新・再送しない。
- `src/js/output/output-view-model.js`: 帳票の表示に `rawDisplay` と棟名称を組み合わせる。
- `src/js/projects/project-building-service.js`: 棟追加・棟名変更の前に、未送信キューの端末永続化結果を再読込して確認する。保存できなかったときに成功扱いで続行しない。
- `tests/multi-building-11G.mjs`: 棟名の優先/既定表示、オフライン採番・ID互換、連続棟追加の未送信パッチ統合、空欄仕上表復元の回帰テストを追加。
- 静的なコード内容・import経路・ブランチ差分を照合。**Nodeテスト未実行**（プライベートGitHubから実行環境へコードを取得できず）。GitHub commit status APIはstatus 0件で、自動CI成功を示す情報なし。Firestore実通信・オフライン実機・2端末受信は未確認。
- 残る要確認: オフラインで同一案件を複数端末から同時追加したときのID衝突検出はまだ専用実装なし（運用で回避する方針）。PDF/Excelの実ファイル描画と、単棟・複数棟の画面回帰確認。

## 2026-11-18 オフライン再起動・同時更新保護（コード反映、実機未確認）

- `src/js/projects/project-controller.js`: オフライン起動時、端末に残る未送信の棟情報（部分パッチ／新規案件作成後パッチ）を案件Snapshotへ反映してから仕上表を復元する。
- `src/js/sync/unsent-queue.js`: 送信したプロジェクトメタデータと同一内容の場合だけ未送信キューを削除するAPIを追加。
- `src/js/firestore/firestore-repository.js`: projectメタデータの送信成功時に条件付き削除を利用。送信失敗時は送信前に登録済みのprojectキューを再登録せず、送信中に増えた後続編集を保護。
- `tests/multi-building-11G.mjs`: 古い送信成功で後続棟名変更の未送信キューを消さない回帰テストを追加（**実行は未確認**）。
- **実機検証必須**: オフライン棟追加→アプリ再起動→棟/仕上表復元→通信復帰→別端末同期、および送信中の連続棟名変更。
- 同一棟IDの多端末同時追加による競合は運用回避方針。検知・停止の実装完了を意味しない。

## 2026-11-18 11Gテストの旧条件整理とService実動作テスト

- Actions失敗 [run 44274756897](https://github.com/odako-kawakubo/chousa-system-pwa/actions/runs/44274756897) は、11Aから連鎖実行される `tests/sample-11C.mjs` が削除済みのオンライン専用採番関数 `reserveNextBuildingForProject` のソース文字列を期待したことが原因。JavaScript構文と参照検査は成功、11Gテストは前段失敗で未実行だった。
- `tests/sample-11C.mjs`: 廃止された実装文字列への依存だけ削除し、サンプル20建材/写真、棟IDと空仕上表の既存振る舞い検証を維持。
- `tests/multi-building-11G-service.mjs`: Nodeのモジュール解決フックでFirebase永続化adapterのみ隔離し、実際の `project-building-service` / `project-store` / `finish-record-store` / `unsent-queue` を操作。オフライン棟追加・連続追加/棟名変更・端末Snapshot再読込からの空構造復元・端末キュー保存失敗・サンプル外部送信抑止を検証する。
- `.github/workflows/test-only-11g.yml`: 従来の11A・11C検証と11G純粋ロジック検証に上記Serviceテストを追加。**deployジョブなし、Hosting/IAM/Secrets変更なし**。
- **実行結果は未確認**。push後のGitHub Actions Runの結果/ログを確認すること。Nodeの擬似adapterテストは実Firestore送信・別端末同期の完了を意味しない。

## 11Gで守る仕様

- 1案件内に複数棟。仕上表と写真タブの棟選択は独立。
- 建材レコード・採取・分析は案件全体で共通。使用箇所は仕上表由来。
- A棟の使用箇所は従来表記、B棟以降は棟識別子を付ける。
- 調査備考は既存の1項目。
- 既存Firestore・ローカルスナップショット・未送信キュー・疎保存を維持する。

## 残課題・確認予定

- **未実施**: JavaScript構文／回帰テストの実行、Firebase実通信、2端末同期、オフライン作成・再起動・通信復帰、iPad実機。
- 建材使用箇所の導出と同期受信後の再計算は既存コードで一部対応済み。仕上表→建材→写真の参照、同時変更時の競合、保存失敗時の保護を追加確認。
- PDF・Excel・目視写真出力の棟別抽出を現行コードで確認し、不足箇所のみ修正する。
- 本番11.3は`main`にあり、11GへはUIのみ選択的に統合した。main全体をマージしない。
- `review-photo-pdf` の公開は、既存の成功済み認証方式を確認してから、公開承認後に実行する。既存Actions、Firebase権限、レビューURLを無断変更しない。

次の作業: ブランチ差分と静的整合性を確認し、棟追加・復帰同期の回帰テストを整備し、建材・写真・出力連携の未対応箇所を特定する。
