# しらべ — 技術運用基準と成功済みデプロイ経路

最終照合: 2026-11-11。これは**確認済み設定の再利用メモ**。正式な権限ルールは [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)、作業の現在地は [CURRENT_HANDOFF.md](./CURRENT_HANDOFF.md)。

## GitHub / Firebase の基礎

| 用途 | 確認できた設定 |
| --- | --- |
| GitHubリポジトリ | `odako-kawakubo/chousa-system-pwa` |
| Firebaseプロジェクト | `odako-chousa-system-pwa` |
| 本番ブランチ | `main`（pushで本番デプロイにつながる） |
| 本番用Actions | `.github/workflows/firebase-hosting-deploy.yml` |
| 従来の通常レビュー | `v0163a` — 既存ワークフロー `.github/workflows/firebase-hosting-preview-v0163a.yml` |
| 今回指定の分岐レビュー | Hosting channel `review-photo-pdf`、URL `https://odako-chousa-system-pwa--review-photo-pdf-amypbo0x.web.app` |
| 11AのActions | `.github/workflows/firebase-hosting-review-photo-pdf-11a.yml` — **初回公開は失敗、未修正** |

※公開チャンネル・レビューURLの保持、サイトID、有効期限、権限、現在の公開版は**公開前に現物確認**。URLの存在をもって最新版が公開済みとは扱わない。

## 成功したデプロイ方式 — 再利用基準

2026-11-10、10Kの `review-photo-pdf` レビュー公開が Actions で成功している。例: [実行 42726165029](https://github.com/odako-kawakubo/chousa-system-pwa/actions/runs/42726165029)。10Kブランチ上の `.github/workflows/firebase-hosting-preview-material-h.yml` と `.github/workflows/firebase-hosting-preview-v01910i.yml` のデプロイ部分も次の方式だった（**既存の成功ファイルを優先して毎回照合**）。

1. GitHub Secrets `FIREBASE_SERVICE_ACCOUNT_ODAKO_CHOUSA_SYSTEM_PWA` の値を Actions Runner の**一時ファイル**へ書き込む（秘密情報をログやリポジトリへ出さない）。
2. 一時ファイルを `GOOGLE_APPLICATION_CREDENTIALS` に設定する。
3. 固定バージョンの CLI `firebase-tools@15.34.0` を使う。
4. レビュー公開コマンド:
   `npx --yes firebase-tools@15.34.0 hosting:channel:deploy review-photo-pdf --expires 30d --project odako-chousa-system-pwa`
5. 実行後、Actionsの `test` と `deploy` の双方の結果、公開URL、配信版／Service Workerキャッシュを確認する。

**重要**: 上記は既存Actionsの成功実績の記録であって、任意のワークフロー変更を承認するものではない。権限が変わっていないのにデプロイが失敗した場合、IAM権限追加を提案する前に**直近成功例の認証方法とCLIの相違**を確認する。

本番向け `.github/workflows/firebase-hosting-deploy.yml` でも2026-11-10の [実行 42738988045](https://github.com/odako-kawakubo/chousa-system-pwa/actions/runs/42738988045) が成功。現在の同ファイル末尾ではサービスアカウント一時ファイル、`GOOGLE_APPLICATION_CREDENTIALS`、`firebase-tools@15.34.0` を利用。**本番への流用やmain更新は別途承認が必須**。

## 11Aで発生した再発防止事例

- [失敗した実行 42981775791](https://github.com/odako-kawakubo/chousa-system-pwa/actions/runs/42981775791)（2026-11-11）: `test` 成功、`deploy` 失敗。
- 11A新設ワークフローが `FirebaseExtended/action-hosting-deploy@v0` を利用し、ログ上は CLI `15.35.0` で実行された。
- Firebase Hosting API状態の照会で HTTP 403、`serviceusage.services.get` が拒否。これは**その実行で観測された事実**。
- IAM設定が変更された証拠はない。**成功済み方式との差があり、認証方式を揃えることが合理的な修正候補**だが、修正後の成功は未確認。ユーザーに再度権限設定変更を求める前にワークフロー差分を調べる。
- 対策: 新しい版を作る前に、同じHostingチャンネルに公開できた**最後の成功実行と実際のワークフロー**を読む。既存方式を変更するなら理由・影響・承認を明示する。

## 安全境界

- 11Aのレビュー公開と、Firestoreのテスト用案件への書込みは別の確認対象。Hosting成功は通信同期成功を意味しない。
- `testProjects` 等の使用は、コード・Firestore Rules・認証権限・実際の接続先を確認した場合に限る。**ユーザーの本番案件をテストに使わない**。
- main、`v0163a`、既存reviewの設定、Firebase IAM、GitHub Secrets、公開URLを勝手に変更しない。
- 未確認の試験を成功と書かない。権限エラーや初回失敗時は、既存の成功経路との差を確認してから修正を提案する。

## 技術運用メモの更新契機

GitHub Actions方式・認証・Firebase構成・同期方式に**ユーザー承認済みの確定変更**があった場合だけ本書の該当箇所を更新し、成功ActionsのURLと確認日を添える。進捗や未解決事項は [CURRENT_HANDOFF.md](./CURRENT_HANDOFF.md) へ書く。秘密鍵やトークンは絶対に記録しない。
