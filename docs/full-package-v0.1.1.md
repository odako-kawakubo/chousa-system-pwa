# 認証確認版 v0.1.1 フルパッケージ

このフォルダは、Microsoft認証確認版を丸ごと置き換えられる一式です。

## 主な内容

- Microsoftログイン・ログアウト
- Firebase Authentication
- Microsoft Graphアクセストークン取得状態の表示
- 認証確認用の静的アプリ画面
- Firebase Hosting設定

## 未接続

- Firestore業務データ同期
- SharePoint案件フォルダ操作
- 写真アップロード
- 仕上表・建材リストの実処理

## Hosting

リポジトリ直下を公開する設定です。

```powershell
firebase.cmd deploy --only hosting
```
