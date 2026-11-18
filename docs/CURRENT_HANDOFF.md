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
